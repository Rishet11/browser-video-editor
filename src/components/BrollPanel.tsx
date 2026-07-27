"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/store";
import type { BrollSuggestion } from "@/lib/broll";

interface Row extends BrollSuggestion {
  key: string;
}

export default function BrollPanel() {
  const present = useEditorStore((s) => s.present);

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
      const res = await fetch(`/api/editor/${present.id}/broll`, { method: "POST" });
      if (res.status === 503) {
        setNotConfigured(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setError(body.error ?? "Request failed");
        return;
      }
      const body = (await res.json()) as { suggestions: BrollSuggestion[]; model: string };
      setModel(body.model);
      setRows(
        body.suggestions.map((s, i) => ({ ...s, key: `${s.afterElementId}:${s.gapStart}:${i}` })),
      );
    } catch {
      setError("Network error contacting the AI provider.");
    } finally {
      setLoading(false);
    }
  }

  function handleDismiss(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-neutral-700 bg-neutral-900 p-3 text-sm text-neutral-200">
      <div className="flex items-center justify-between">
        <span className="font-medium">AI B-roll suggestions</span>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={loading || !present}
          className="rounded bg-neutral-700 px-3 py-1 text-xs hover:bg-neutral-600 disabled:opacity-50"
        >
          {loading ? "thinking…" : "Suggest B-roll"}
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
        <p className="text-xs text-neutral-500">No coverage gaps found.</p>
      )}

      {model && <p className="text-[10px] text-neutral-500">model: {model}</p>}

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex flex-col gap-1 rounded border border-neutral-800 bg-neutral-950 p-2"
          >
            <div className="text-xs font-medium">
              gap {row.gapStart}s – {(row.gapStart + row.gapDuration).toFixed(2)}s ({row.shotType})
            </div>
            <div className="flex flex-wrap gap-1">
              {row.searchTerms.map((term) => (
                <span
                  key={term}
                  className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300"
                >
                  {term}
                </span>
              ))}
            </div>
            <div className="text-xs italic text-neutral-500">{row.reason}</div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleDismiss(row.key)}
                className="rounded bg-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-600"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
