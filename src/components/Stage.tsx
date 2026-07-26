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
  const [containerWidth, setContainerWidth] = useState(0);
  const { registerVideoRef } = usePlayback();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const scale = containerWidth > 0 ? containerWidth / edl.width : 0;
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

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        aspectRatio: `${edl.width} / ${edl.height}`,
        position: "relative",
        overflow: "hidden",
        background: "black",
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
                onClick={() => onSelectElement?.(el.id)}
                style={{ ...baseStyle, ...css, position: "absolute", left: x, top: y }}
              >
                {text}
              </div>
            );
          }

          if (el.type === "image") {
            const src = str(el.props.src, "");
            return (
              <div key={el.id} onClick={() => onSelectElement?.(el.id)} style={baseStyle}>
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
  );
}
