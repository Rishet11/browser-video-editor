"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/store";

function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function saveStatusLabel(
  status: "saving" | "saved" | "error" | "conflict" | null,
): string | null {
  if (status === "saving") return "saving…";
  if (status === "saved") return "saved";
  if (status === "error") return "save failed";
  if (status === "conflict") return "Someone else changed this. Reload to get the latest.";
  return null;
}

export default function Toolbar() {
  const present = useEditorStore((s) => s.present);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const playhead = useEditorStore((s) => s.playhead);
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
    <header className="flex items-center gap-3 border-b border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-100">
      <div className="min-w-0 mr-auto">
        <div className="truncate font-semibold tracking-tight">{present?.name || "Untitled composition"}</div>
        <div className="text-[11px] text-neutral-500">
          MagicRoll Editor <span className="px-1">·</span> {formatClock(playhead)} / {formatClock(present?.duration ?? 0)}
        </div>
      </div>
      {statusLabel && (
        <span className={saveStatus === "error" || saveStatus === "conflict" ? "text-amber-300" : "text-neutral-400"}>
          {statusLabel}
        </span>
      )}
      <button
        onClick={handleExport}
        disabled={!present || exporting}
        className="px-3 py-1 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exporting ? "exporting…" : "Export HTML"}
      </button>
      {error && <span className="text-red-400">{error}</span>}
    </header>
  );
}
