"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveAt, type EDL } from "@/lib/edl";
import { usePlayback } from "@/hooks/usePlayback";

interface StageProps {
  edl: EDL;
  playhead: number;
  onSelectElement?: (id: string) => void;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

export default function Stage({ edl, playhead, onSelectElement }: StageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const { registerVideoRef } = usePlayback();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    setBox({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  /**
   * Fit to whichever dimension runs out first.
   *
   * Scaling from width alone is the obvious version and it is wrong: on a wide
   * window the derived height exceeds the space available and the canvas pushes
   * the timeline off the bottom of the screen. Taking the smaller of the two
   * ratios letterboxes instead, which is what "scale to fit, preserve aspect
   * ratio" actually asks for.
   */
  const scale =
    box.width > 0 && box.height > 0
      ? Math.min(box.width / edl.width, box.height / edl.height)
      : 0;
  const displayWidth = edl.width * scale;
  const displayHeight = edl.height * scale;
  const visible = resolveAt(edl, playhead);
  const visibleIds = new Set(visible.map((el) => el.id));

  // All video elements in the composition, mounted for the entire session.
  // resolveAt decides *visibility* per frame (via `visibleIds`), but it must
  // never decide *mounting*: unmounting a <video> and remounting it later
  // reloads the media element and restarts playback from zero. So every
  // video element gets one stable DOM node here, hidden with opacity when
  // resolveAt says it isn't in the current frame's visible window, and the
  // rAF sync loop (usePlayback) seeks/plays/pauses whichever ones are
  // registered and currently visible.
  const allVideoElements = useMemo(
    () => edl.layers.flatMap((l) => l.elements).filter((el) => el.type === "video"),
    [edl],
  );

  /**
   * Explicit paint order per element id.
   *
   * `resolveAt` returns elements already sorted by layer index, and for a single
   * mapped list DOM order alone would be enough. It is not enough here: videos
   * are mounted persistently in a second pass after the per-frame children, so
   * DOM order would always paint them last and a caption on a higher layer would
   * disappear behind a full-frame video. Deriving `zIndex` from the layer index
   * keeps the EDL the single authority on stacking, which is what the data model
   * claims ("Layer.index is both z-order and track position").
   */
  const zIndexById = useMemo(() => {
    const map = new Map<string, number>();
    const ordered = [...edl.layers].sort((a, b) => a.index - b.index);
    ordered.forEach((layer, layerOrder) => {
      layer.elements.forEach((el, i) => {
        map.set(el.id, layerOrder * 1000 + i);
      });
    });
    return map;
  }, [edl]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: "black",
      }}
    >
      {/* The 16:9 frame itself, sized to the fitted scale so it never overflows. */}
      <div
        id="stage"
        style={{
          position: "relative",
          overflow: "hidden",
          background: "black",
          width: displayWidth || undefined,
          height: displayHeight || undefined,
          aspectRatio: `${edl.width} / ${edl.height}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: edl.width,
            height: edl.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
        {visible.map((el) => {
          const x = num(el.props.x, 0);
          const y = num(el.props.y, 0);
          const w = num(el.props.w, 100);
          const h = num(el.props.h, 100);

          const baseStyle: React.CSSProperties = {
            position: "absolute",
            left: x,
            top: y,
            width: w,
            height: h,
            zIndex: zIndexById.get(el.id) ?? 0,
          };

          if (el.type === "text") {
            const text = str(el.props.text, "");
            const css =
              el.props.css && typeof el.props.css === "object"
                ? (el.props.css as React.CSSProperties)
                : {};
            return (
              <div
                key={el.id}
                data-element-id={el.id}
                onClick={() => onSelectElement?.(el.id)}
                style={{
                  ...baseStyle,
                  ...css,
                  position: "absolute",
                  left: x,
                  top: y,
                  zIndex: zIndexById.get(el.id) ?? 0,
                }}
              >
                {text}
              </div>
            );
          }

          if (el.type === "image") {
            const src = str(el.props.src, "");
            return (
              <div
                key={el.id}
                data-element-id={el.id}
                onClick={() => onSelectElement?.(el.id)}
                style={baseStyle}
              >
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
            );
          }

          // Video elements are rendered persistently below, outside this
          // per-frame map, so they stay mounted for the whole session.
          return null;
        })}

        {allVideoElements.map((el) => {
          const x = num(el.props.x, 0);
          const y = num(el.props.y, 0);
          const w = num(el.props.w, 100);
          const h = num(el.props.h, 100);
          const src = str(el.props.src, "");
          const isVisible = visibleIds.has(el.id);

          return (
            <div
              key={el.id}
              onClick={() => onSelectElement?.(el.id)}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: w,
                height: h,
                zIndex: zIndexById.get(el.id) ?? 0,
                opacity: isVisible ? 1 : 0,
                visibility: isVisible ? "visible" : "hidden",
                pointerEvents: isVisible ? "auto" : "none",
              }}
            >
              <video
                muted
                playsInline
                preload="auto"
                src={src}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                ref={(node) => {
                  if (node) {
                    registerVideoRef(el.id, node);
                  } else {
                    registerVideoRef(el.id, null);
                  }
                }}
              />
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
