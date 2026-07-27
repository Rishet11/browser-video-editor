"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/store";
import type { BaseElement } from "@/lib/edl";
import { formatSeconds } from "@/lib/format";

interface FormState {
  start: string;
  duration: string;
  trimIn: string;
  x: string;
  y: string;
  w: string;
  h: string;
  text: string;
  src: string;
}

function toFormState(el: BaseElement): FormState {
  return {
    start: formatSeconds(el.start),
    duration: formatSeconds(el.duration),
    trimIn: formatSeconds(el.trimIn),
    x: String(el.props.x ?? ""),
    y: String(el.props.y ?? ""),
    w: String(el.props.w ?? ""),
    h: String(el.props.h ?? ""),
    text: typeof el.props.text === "string" ? el.props.text : "",
    src: typeof el.props.src === "string" ? el.props.src : "",
  };
}

function findElement(
  present: ReturnType<typeof useEditorStore.getState>["present"],
  id: string | null,
): BaseElement | null {
  if (!present || !id) return null;
  for (const layer of present.layers) {
    const found = layer.elements.find((e) => e.id === id);
    if (found) return found;
  }
  return null;
}

export default function PropertiesPanel() {
  const present = useEditorStore((s) => s.present);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const patchElement = useEditorStore((s) => s.patchElement);

  const element = findElement(present, selectedElementId);

  const [form, setForm] = useState<FormState | null>(element ? toFormState(element) : null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The inputs are local state so typing does not fight the store on every
   * keystroke, but they must resync when the selection changes or when the
   * element is edited from elsewhere (a timeline drag, an undo, an applied AI
   * suggestion). Comparing a signature during render is React's recommended way
   * to do that: an effect calling setState would schedule a second render pass
   * for every store change.
   */
  const signature = element
    ? `${element.id}|${element.start}|${element.duration}|${element.trimIn}|${JSON.stringify(element.props)}`
    : "none";
  const [syncedSignature, setSyncedSignature] = useState(signature);
  if (syncedSignature !== signature) {
    setSyncedSignature(signature);
    setForm(element ? toFormState(element) : null);
    setError(null);
  }

  if (!element || !form || !selectedElementId) {
    return (
      <div className="p-4 text-neutral-400 text-sm bg-neutral-900 border-l border-neutral-700 w-64">
        No element selected
      </div>
    );
  }

  const commitNumberField = (field: "start" | "duration" | "trimIn", value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      setForm(toFormState(element));
      setError("Invalid number");
      return;
    }
    const ok = patchElement(selectedElementId, { [field]: num });
    if (!ok) {
      setForm(toFormState(element));
      setError(`Rejected: invalid ${field}`);
    } else {
      setError(null);
    }
  };

  const commitPropsField = (field: "x" | "y" | "w" | "h", value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      setForm(toFormState(element));
      setError("Invalid number");
      return;
    }
    const ok = patchElement(selectedElementId, { props: { ...element.props, [field]: num } });
    if (!ok) {
      setForm(toFormState(element));
      setError(`Rejected: invalid ${field}`);
    } else {
      setError(null);
    }
  };

  const commitTextField = (field: "text" | "src", value: string) => {
    const ok = patchElement(selectedElementId, { props: { ...element.props, [field]: value } });
    if (!ok) {
      setForm(toFormState(element));
      setError(`Rejected: invalid ${field}`);
    } else {
      setError(null);
    }
  };

  const numberInput = (
    label: string,
    field: keyof Pick<FormState, "start" | "duration" | "trimIn" | "x" | "y" | "w" | "h">,
    onCommit: (value: string) => void,
  ) => (
    <label className="flex flex-col gap-1 text-xs text-neutral-300">
      {label}
      <input
        type="number"
        className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-white"
        value={form[field]}
        onChange={(e) => setForm({ ...form, [field]: e.target.value })}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );

  return (
    <div className="p-4 flex flex-col gap-3 bg-neutral-900 border-l border-neutral-700 w-64 text-white">
      <div>
        <div className="text-xs text-neutral-500">Type</div>
        <div className="text-sm">{element.type}</div>
      </div>
      <div>
        <div className="text-xs text-neutral-500">ID</div>
        <div className="text-sm break-all">{element.id}</div>
      </div>

      {numberInput("Start", "start", (v) => commitNumberField("start", v))}
      {numberInput("Duration", "duration", (v) => commitNumberField("duration", v))}
      {numberInput("Trim In", "trimIn", (v) => commitNumberField("trimIn", v))}
      {numberInput("X", "x", (v) => commitPropsField("x", v))}
      {numberInput("Y", "y", (v) => commitPropsField("y", v))}
      {numberInput("W", "w", (v) => commitPropsField("w", v))}
      {numberInput("H", "h", (v) => commitPropsField("h", v))}

      {element.type === "text" && (
        <label className="flex flex-col gap-1 text-xs text-neutral-300">
          Text
          <input
            type="text"
            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-white"
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            onBlur={(e) => commitTextField("text", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
      )}

      {(element.type === "image" || element.type === "video") && (
        <label className="flex flex-col gap-1 text-xs text-neutral-300">
          Src
          <input
            type="text"
            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-white"
            value={form.src}
            onChange={(e) => setForm({ ...form, src: e.target.value })}
            onBlur={(e) => commitTextField("src", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
