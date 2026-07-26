"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store";
import type { EDL } from "@/lib/edl";

/** Debounce window before an edit is persisted, in ms. */
const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * Persists the EDL after edits settle.
 *
 * The client holds the authoritative document and `PUT` replaces it wholesale,
 * which is why autosave can be a debounce rather than a change log: sending the
 * same EDL twice is indistinguishable from sending it once.
 *
 * Two things this deliberately avoids:
 * - Saving the EDL that was just loaded. The first `present` a session sees came
 *   from the server, so writing it straight back would be a pointless round trip
 *   on every page load. `lastSavedRef` is primed with it instead.
 * - Saving mid-drag. Every pointermove produces a new EDL, so an undebounced
 *   save would issue a request per mouse event.
 */
export function useAutosave(enabled: boolean) {
  const present = useEditorStore((s) => s.present);
  const setSaveStatus = useEditorStore((s) => s.setSaveStatus);
  const lastSavedRef = useRef<EDL | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Aborts a save that is still in flight when a newer edit supersedes it. */
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !present) return;

    // Prime with the first EDL seen; do not save it back.
    if (lastSavedRef.current === null) {
      lastSavedRef.current = present;
      return;
    }
    if (lastSavedRef.current === present) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const snapshot = present;
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;
      setSaveStatus("saving");

      fetch(`/api/editor/${snapshot.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`save failed: ${res.status}`);
          lastSavedRef.current = snapshot;
          setSaveStatus("saved");
        })
        .catch((err: unknown) => {
          // An aborted request was superseded by a newer edit, not a failure.
          if (err instanceof DOMException && err.name === "AbortError") return;
          setSaveStatus("error");
        });
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, present, setSaveStatus]);

  useEffect(() => {
    return () => inFlightRef.current?.abort();
  }, []);
}
