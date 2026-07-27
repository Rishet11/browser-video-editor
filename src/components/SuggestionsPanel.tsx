"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/store";
import type { TimingSuggestion } from "@/lib/suggestions";
import type { BaseElement } from "@/lib/edl";
import { formatSeconds } from "@/lib/format";

interface Row extends TimingSuggestion {
  status: "pending" | "applying" | "applied" | "error";
  error?: string;
}

function elementLabel(el: BaseElement | undefined): string {
  if (!el) return "unknown element";
  if (el.type === "text") {
    const text = typeof el.props.text === "string" ? el.props.text : "";
    return `text "${text.length > 24 ? `${text.slice(0, 24)}…` : text}"`;
  }
  const src = typeof el.props.src === "string" ? el.props.src : "";
  const filename = src.split("/").pop() ?? src;
  return `${el.type} "${filename}"`;
}

function findElement(edl: ReturnType<typeof useEditorStore.getState>["present"], id: string) {
  if (!edl) return undefined;
  for (const layer of edl.layers) {
    const el = layer.elements.find((e) => e.id === id);
    if (el) return el;
  }
  return undefined;
}

export default function SuggestionsPanel() {
  const present = useEditorStore((s) => s.present);
  const patchElement = useEditorStore((s) => s.patchElement);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    if (!present) return;
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    setRows([]);
    setModel(null);
    try {
      const res = await fetch(`/api/editor/${present.id}/suggest`, { method: "POST" });
      if (res.status === 503) {
        setNotConfigured(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setError(body.error ?? "Request failed");
        return;
      }
      const body = (await res.json()) as { suggestions: TimingSuggestion[]; model: string };
      setModel(body.model);
      setRows(body.suggestions.map((s) => ({ ...s, status: "pending" as const })));
    } catch {
      setError("Network error contacting the AI provider.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply(elementId: string) {
    if (!present) return;
    const row = rows.find((r) => r.elementId === elementId);
    if (!row) return;

    setRows((rs) =>
      rs.map((r) => (r.elementId === elementId ? { ...r, status: "applying" } : r)),
    );

    try {
      const res = await fetch(`/api/editor/${present.id}/element/${elementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: row.suggestedStart,
          duration: row.suggestedDuration,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Apply failed" }));
        setRows((rs) =>
          rs.map((r) =>
            r.elementId === elementId
              ? { ...r, status: "error", error: body.error ?? "Apply failed" }
              : r,
          ),
        );
        return;
      }
      patchElement(elementId, {
        start: row.suggestedStart,
        duration: row.suggestedDuration,
      });
      setRows((rs) =>
        rs.map((r) => (r.elementId === elementId ? { ...r, status: "applied" } : r)),
      );
    } catch {
      setRows((rs) =>
        rs.map((r) =>
          r.elementId === elementId ? { ...r, status: "error", error: "Network error" } : r,
        ),
      );
    }
  }

  function handleDismiss(elementId: string) {
    setRows((rs) => rs.filter((r) => r.elementId !== elementId));
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-neutral-700 bg-neutral-900 p-3 text-sm text-neutral-200">
      <div className="flex items-center justify-between">
        <span className="font-medium">AI timing suggestions</span>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={loading || !present}
          className="rounded bg-neutral-700 px-3 py-1 text-xs hover:bg-neutral-600 disabled:opacity-50"
        >
          {loading ? "thinking…" : "Suggest timings"}
        </button>
      </div>

      {notConfigured && (
        <p className="text-xs text-neutral-400">AI suggestions are not configured.</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!loading && !notConfigured && !error && rows.length === 0 && model === null && (
        <p className="text-xs text-neutral-500">No suggestions requested yet.</p>
      )}
      {!loading && rows.length === 0 && model !== null && (
        <p className="text-xs text-neutral-500">No applicable suggestions.</p>
      )}

      {model && <p className="text-[10px] text-neutral-500">model: {model}</p>}

      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const el = findElement(present, row.elementId);
          const startChanged = el ? Math.abs(el.start - row.suggestedStart) > 0.001 : true;
          const durationChanged = el
            ? Math.abs(el.duration - row.suggestedDuration) > 0.001
            : true;
          return (
            <div
              key={row.elementId}
              className="flex flex-col gap-1 rounded border border-neutral-800 bg-neutral-950 p-2"
            >
              <div className="text-xs font-medium">{elementLabel(el)}</div>
              <div className="text-xs text-neutral-400">
                <span className={startChanged ? "text-yellow-400" : ""}>
                  start {el ? formatSeconds(el.start) : "?"} → {formatSeconds(row.suggestedStart)}
                </span>
                {"  "}
                <span className={durationChanged ? "text-yellow-400" : ""}>
                  duration {el ? formatSeconds(el.duration) : "?"} →{" "}
                  {formatSeconds(row.suggestedDuration)}
                </span>
              </div>
              <div className="text-xs italic text-neutral-500">{row.reason}</div>
              {row.status === "error" && (
                <div className="text-xs text-red-400">{row.error}</div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleApply(row.elementId)}
                  disabled={row.status === "applying" || row.status === "applied"}
                  className="rounded bg-blue-700 px-2 py-0.5 text-xs hover:bg-blue-600 disabled:opacity-50"
                >
                  {row.status === "applied" ? "Applied" : "Apply"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDismiss(row.elementId)}
                  className="rounded bg-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-600"
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
