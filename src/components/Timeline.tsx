"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { usePlayback } from "@/hooks/usePlayback";
import type { BaseElement } from "@/lib/edl";

function isFormElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function elementLabel(el: BaseElement): string {
  if (el.type === "text" && typeof el.props.text === "string") {
    const text = el.props.text as string;
    return text.length > 20 ? `${text.slice(0, 20)}…` : text;
  }
  return `${el.type}:${el.id}`;
}

export default function Timeline() {
  const present = useEditorStore((s) => s.present);
  const playhead = useEditorStore((s) => s.playhead);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const beginDrag = useEditorStore((s) => s.beginDrag);
  const endDrag = useEditorStore((s) => s.endDrag);
  const moveElement = useEditorStore((s) => s.moveElement);
  const trimElement = useEditorStore((s) => s.trimElement);
  const splitElement = useEditorStore((s) => s.splitElement);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const { scrub, play, pause } = usePlayback();
  const playingState = useEditorStore((s) => s.playing);

  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    errorTimeoutRef.current = setTimeout(() => setError(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    };
  }, []);

  const pxToSeconds = useCallback(
    (px: number): number => {
      if (!present || !tracksContainerRef.current) return 0;
      const trackWidth = tracksContainerRef.current.getBoundingClientRect().width;
      if (trackWidth <= 0) return 0;
      return (px / trackWidth) * present.duration;
    },
    [present],
  );

  const clientXToSeconds = useCallback(
    (clientX: number): number => {
      if (!present || !tracksContainerRef.current) return 0;
      const rect = tracksContainerRef.current.getBoundingClientRect();
      const relX = clientX - rect.left;
      return pxToSeconds(relX);
    },
    [present, pxToSeconds],
  );

  // drag state
  const dragRef = useRef<{
    kind: "move" | "trim-start" | "trim-end";
    elementId: string;
    startClientX: number;
    originalStart: number;
    originalDuration: number;
    originalTrimIn: number;
    /**
     * Delta already handed to `trimElement`. `trimElement` shifts the CURRENT
     * value by the delta it is given, but `deltaSeconds` below is measured from
     * where the drag started, so passing it raw on every pointermove would
     * re-apply the whole offset each time and compound. We pass the increment
     * since the last accepted call instead, and leave this untouched when an
     * edit is rejected so the next move retries the same increment.
     */
    appliedDelta: number;
  } | null>(null);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !present) return;
      const deltaSeconds = pxToSeconds(e.clientX - drag.startClientX);

      if (drag.kind === "move") {
        // moveElement takes an absolute start, so the delta-from-origin is
        // correct here and cannot compound.
        const ok = moveElement(drag.elementId, drag.originalStart + deltaSeconds);
        if (!ok) showError("Move rejected: out of bounds.");
      } else {
        const increment = deltaSeconds - drag.appliedDelta;
        if (increment === 0) return;
        const edge = drag.kind === "trim-start" ? "start" : "end";
        const ok = trimElement(drag.elementId, edge, increment);
        if (ok) {
          drag.appliedDelta = deltaSeconds;
        } else {
          showError(
            edge === "start"
              ? "Trim rejected: below minimum duration or out of bounds."
              : "Trim rejected: below minimum duration.",
          );
        }
      }
    },
    [present, pxToSeconds, moveElement, trimElement, showError],
  );

  /**
   * Listeners for the in-flight drag. An AbortController unbinds both of them in
   * one call, which also covers a pointercancel or a drag that ends outside the
   * window, so a drag can never get stuck.
   */
  const dragAbortRef = useRef<AbortController | null>(null);

  const endDragInteraction = useCallback(() => {
    dragRef.current = null;
    dragAbortRef.current?.abort();
    dragAbortRef.current = null;
    endDrag();
  }, [endDrag]);

  const startDrag = useCallback(
    (
      kind: "move" | "trim-start" | "trim-end",
      el: BaseElement,
      e: React.PointerEvent,
    ) => {
      e.stopPropagation();
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragRef.current = {
        kind,
        elementId: el.id,
        startClientX: e.clientX,
        originalStart: el.start,
        originalDuration: el.duration,
        originalTrimIn: el.trimIn,
        appliedDelta: 0,
      };
      selectElement(el.id);
      // The whole drag becomes one undo step.
      beginDrag();
      dragAbortRef.current?.abort();
      const controller = new AbortController();
      dragAbortRef.current = controller;
      const { signal } = controller;
      window.addEventListener("pointermove", handlePointerMove, { signal });
      window.addEventListener("pointerup", endDragInteraction, { signal });
      window.addEventListener("pointercancel", endDragInteraction, { signal });
    },
    [selectElement, beginDrag, handlePointerMove, endDragInteraction],
  );

  // Never leave a drag armed if the component unmounts mid-gesture.
  useEffect(() => {
    return () => dragAbortRef.current?.abort();
  }, []);

  const handleSplit = useCallback(() => {
    if (!selectedElementId) {
      showError("No element selected.");
      return;
    }
    const ok = splitElement(selectedElementId, playhead);
    if (!ok) showError("Split rejected: playhead outside element or half too short.");
  }, [selectedElementId, playhead, splitElement, showError]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isFormElement(document.activeElement)) return;

      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleSplit();
      } else if (e.key === " ") {
        e.preventDefault();
        if (playingState) pause();
        else play();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSplit, playingState, play, pause, undo, redo]);

  if (!present) return null;

  const layers = [...present.layers].sort((a, b) => b.index - a.index);
  const playheadPct = (playhead / present.duration) * 100;

  const handleTrackClick = (e: React.MouseEvent) => {
    const t = clientXToSeconds(e.clientX);
    scrub(t);
  };

  return (
    <div className="flex flex-col bg-neutral-900 text-white border-t border-neutral-700 select-none">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-neutral-700">
        <button
          className="px-2 py-1 text-xs bg-neutral-700 rounded hover:bg-neutral-600"
          onClick={handleSplit}
        >
          Split (S)
        </button>
        <span className="text-xs text-neutral-400">
          {playhead.toFixed(2)}s / {present.duration.toFixed(2)}s
        </span>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      <div
        ref={tracksContainerRef}
        className="relative"
        onClick={handleTrackClick}
        style={{ cursor: "text" }}
      >
        {/* playhead line */}
        <div
          className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none"
          style={{ left: `${playheadPct}%` }}
        />
        {layers.map((layer) => (
          <div
            key={layer.id}
            className="relative h-12 border-b border-neutral-800"
          >
            <div className="absolute left-1 top-1 text-[10px] text-neutral-500 z-10 pointer-events-none">
              {layer.name}
            </div>
            {layer.elements.map((el) => {
              const leftPct = (el.start / present.duration) * 100;
              const widthPct = (el.duration / present.duration) * 100;
              const isSelected = selectedElementId === el.id;
              return (
                <div
                  key={el.id}
                  onPointerDown={(e) => startDrag("move", el, e)}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectElement(el.id);
                  }}
                  className={`absolute top-1 bottom-1 rounded bg-blue-700/80 hover:bg-blue-600/80 overflow-hidden text-[10px] px-2 flex items-center cursor-grab ${
                    isSelected ? "ring-2 ring-yellow-400" : ""
                  }`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                >
                  <span className="truncate pointer-events-none">{elementLabel(el)}</span>
                  <div
                    onPointerDown={(e) => startDrag("trim-start", el, e)}
                    className="absolute left-0 top-0 bottom-0 w-2"
                    style={{ cursor: "ew-resize" }}
                  />
                  <div
                    onPointerDown={(e) => startDrag("trim-end", el, e)}
                    className="absolute right-0 top-0 bottom-0 w-2"
                    style={{ cursor: "ew-resize" }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
