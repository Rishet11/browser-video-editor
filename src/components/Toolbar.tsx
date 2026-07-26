"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/store";

function saveStatusLabel(status: "saving" | "saved" | "error" | null): string | null {
  if (status === "saving") return "saving…";
  if (status === "saved") return "saved";
  if (status === "error") return "save failed";
  return null;
}

export default function Toolbar() {
  const present = useEditorStore((s) => s.present);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = saveStatusLabel(saveStatus);

  async function handleExport() {
    if (!present || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/editor/${present.id}/export`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${present.name || "composition"}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex items-center gap-3 bg-neutral-900 text-neutral-100 px-3 py-2 text-sm">
      <button
        onClick={handleExport}
        disabled={!present || exporting}
        className="px-3 py-1 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exporting ? "exporting…" : "Export HTML"}
      </button>
      {error && <span className="text-red-400">{error}</span>}
      {statusLabel && <span className="text-neutral-400">{statusLabel}</span>}
    </div>
  );
}
