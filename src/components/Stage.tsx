"use client";

import { useEffect, useRef, useState } from "react";
import { resolveAt, type EDL } from "@/lib/edl";

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

          // Phase 6 replaces this branch with real <video> sync
          return (
            <div
              key={el.id}
              onClick={() => onSelectElement?.(el.id)}
              style={{
                ...baseStyle,
                background: "#1a1a1a",
                color: "#666",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {el.id}
            </div>
          );
        })}
      </div>
    </div>
  );
}
