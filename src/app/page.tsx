"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { SEED_EDL } from "@/lib/seed";
import { useAutosave } from "@/hooks/useAutosave";
import Stage from "@/components/Stage";
import PlaybackControls from "@/components/PlaybackControls";
import Timeline from "@/components/Timeline";
import PropertiesPanel from "@/components/PropertiesPanel";
import Toolbar from "@/components/Toolbar";
import SuggestionsPanel from "@/components/SuggestionsPanel";
import BrollPanel from "@/components/BrollPanel";

// Default composition loaded on init. prisma/seed.ts seeds it so fresh
// deploys show something without requiring user input.
const DEFAULT_COMPOSITION_ID = SEED_EDL.id;

export default function Home() {
  const present = useEditorStore((s) => s.present);
  const playhead = useEditorStore((s) => s.playhead);
  const load = useEditorStore((s) => s.load);
  const selectElement = useEditorStore((s) => s.selectElement);
  const setLastModified = useEditorStore((s) => s.setLastModified);

  const loadStartedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"inspector" | "assist">("inspector");

  // Autosave only once the composition is known to exist server-side. Saving a
  // local fallback would PUT to an id the database does not have.
  useAutosave(persisted);

  useEffect(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;

    fetch(`/api/editor/${DEFAULT_COMPOSITION_ID}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`load failed: ${res.status}`);
        const lastModified = res.headers.get("last-modified");
        load(await res.json());
        if (lastModified) setLastModified(lastModified);
        setPersisted(true);
      })
      .catch(() => {
        // Fall back to the bundled composition so the editor is still usable
        // (and demoable) when the database is unreachable or unseeded. Edits are
        // not persisted in that mode, which the banner says plainly.
        load(SEED_EDL);
        setLoadError(
          "Could not reach the database. Showing the bundled demo composition; edits will not be saved.",
        );
      });
  }, [load, setLastModified]);

  if (!present) {
    return (
      <div className="flex flex-1 items-center justify-center bg-black text-white">
        Loading composition…
      </div>
    );
  }

  // min-h-0 on the root matters: as a flex child of body it defaults to
  // min-height:auto and can't shrink below min-content. min-h-0 lets it shrink
  // so the side panel's overflow-y-auto actually scrolls instead of pushing
  // content off-screen when panels are taller than viewport.
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-black">
      {loadError && (
        <div className="px-3 py-2 text-xs bg-amber-900/60 text-amber-100 border-b border-amber-700">
          {loadError}
        </div>
      )}
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* min-h-0 lets the canvas shrink instead of pushing the timeline
              off-screen; Stage fits itself to whatever box it is given. */}
          <div className="flex-1 min-h-0">
            <Stage edl={present} playhead={playhead} onSelectElement={selectElement} />
          </div>
          <PlaybackControls />
        </div>
        <aside className="flex flex-col w-80 min-h-0 border-l border-neutral-700 bg-neutral-900">
          <div className="flex border-b border-neutral-700 px-3 pt-3 gap-1">
            <button
              type="button"
              onClick={() => setSidebarTab("inspector")}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                sidebarTab === "inspector"
                  ? "border-blue-400 text-white"
                  : "border-transparent text-neutral-500 hover:text-neutral-200"
              }`}
            >
              Inspector
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("assist")}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                sidebarTab === "assist"
                  ? "border-blue-400 text-white"
                  : "border-transparent text-neutral-500 hover:text-neutral-200"
              }`}
            >
              Assist
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {sidebarTab === "inspector" ? (
              <PropertiesPanel />
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs leading-5 text-neutral-400">
                  Use timing help to review pacing, or plan B-roll for moments that need more visual variety.
                  Suggestions never change the edit until you choose to apply them.
                </p>
                <SuggestionsPanel />
                <BrollPanel />
              </div>
            )}
          </div>
        </aside>
      </div>
      <Timeline />
    </div>
  );
}
