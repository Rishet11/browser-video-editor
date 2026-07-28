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

  // Scale to fit: take the smaller ratio to prevent overflow. Width alone is
  // wrong — it pushes the timeline off-screen on wide windows. Smaller of the two
  // ratios letterboxes correctly.
  const scale =
    box.width > 0 && box.height > 0
      ? Math.min(box.width / edl.width, box.height / edl.height)
      : 0;
  const displayWidth = edl.width * scale;
  const displayHeight = edl.height * scale;
  const visible = resolveAt(edl, playhead);
  const visibleIds = new Set(visible.map((el) => el.id));

  // Videos mount once and stay mounted — resolveAt controls visibility only.
  // Unmounting/remounting causes reload and playback restarts. Each video gets
  // one stable DOM node, hidden with opacity when out of the visible window.
  // usePlayback syncs playback on the registered visible ones.
  const allVideoElements = useMemo(
    () => edl.layers.flatMap((l) => l.elements).filter((el) => el.type === "video"),
    [edl],
  );

  // Explicit z-index per element. resolveAt sorts by layer, but videos mount
  // in a separate pass below, so DOM order alone would paint them last and bury
  // captions on higher layers. zIndex keeps the EDL as the stacking authority.
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
      {/* The 16:9 canvas, scaled to fit. */}
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

          // Videos render persistently in a separate pass below; skip them here.
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
