"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store";
import { SEED_EDL } from "@/lib/seed";
import Stage from "@/components/Stage";
import PlaybackControls from "@/components/PlaybackControls";
import Timeline from "@/components/Timeline";
import PropertiesPanel from "@/components/PropertiesPanel";

export default function Home() {
  const present = useEditorStore((s) => s.present);
  const playhead = useEditorStore((s) => s.playhead);
  const load = useEditorStore((s) => s.load);
  const selectElement = useEditorStore((s) => s.selectElement);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    // TODO: replace with GET /api/editor/[id] once the API layer lands.
    load(SEED_EDL);
  }, [load]);

  if (!present) {
    return (
      <div className="flex flex-1 items-center justify-center bg-black text-white">
        Loading composition…
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-black">
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1">
          <Stage edl={present} playhead={playhead} onSelectElement={selectElement} />
          <PlaybackControls />
        </div>
        <PropertiesPanel />
      </div>
      <Timeline />
    </div>
  );
}
