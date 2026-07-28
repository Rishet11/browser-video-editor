"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store";
import type { EDL } from "@/lib/edl";

// Debounce before persisting edits (ms).
const AUTOSAVE_DEBOUNCE_MS = 800;

// Autosave fires on edit settle (debounced) since PUT replaces the whole EDL.
// Skips two things: the EDL loaded from server (lastSavedRef starts with it
// so we don't bounce it back), and mid-drag saves (every pointermove would be
// a request without debounce).
export function useAutosave(enabled: boolean) {
  const present = useEditorStore((s) => s.present);
  const setSaveStatus = useEditorStore((s) => s.setSaveStatus);
  const lastModified = useEditorStore((s) => s.lastModified);
  const setLastModified = useEditorStore((s) => s.setLastModified);
  const lastSavedRef = useRef<EDL | null>(null);
  // Read inside the debounce callback so PUT gets the latest value.
  const lastModifiedRef = useRef<string | null>(lastModified);
  useEffect(() => {
    lastModifiedRef.current = lastModified;
  }, [lastModified]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Abort mid-flight saves when a newer edit lands.
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

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (lastModifiedRef.current) {
        headers["x-if-unmodified-since"] = lastModifiedRef.current;
      }

      fetch(`/api/editor/${snapshot.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(snapshot),
        signal: controller.signal,
      })
        .then((res) => {
          if (res.status === 409) {
            // Do not retry and do not mark saved: leaving lastSavedRef stale
            // means a later edit will still be recognized as unsaved.
            setSaveStatus("conflict");
            return;
          }
          if (!res.ok) throw new Error(`save failed: ${res.status}`);
          const newLastModified = res.headers.get("last-modified");
          if (newLastModified) setLastModified(newLastModified);
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
  }, [enabled, present, setSaveStatus, setLastModified]);

  useEffect(() => {
    return () => inFlightRef.current?.abort();
  }, []);
}
