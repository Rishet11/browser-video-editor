"use client";

import { useEditorStore } from "@/lib/store";
import { usePlayback } from "@/hooks/usePlayback";

export default function PlaybackControls() {
  const present = useEditorStore((s) => s.present);
  const playhead = useEditorStore((s) => s.playhead);
  const speed = useEditorStore((s) => s.speed);
  const { play, pause, stop, scrub, setSpeed } = usePlayback();

  const duration = present?.duration ?? 0;

  return (
    <div className="flex items-center gap-2 p-2 text-sm text-white bg-neutral-900">
      <button className="px-2 py-1 bg-neutral-700" onClick={play}>
        Play
      </button>
      <button className="px-2 py-1 bg-neutral-700" onClick={pause}>
        Pause
      </button>
      <button className="px-2 py-1 bg-neutral-700" onClick={stop}>
        Stop
      </button>
      <input
        type="range"
        min={0}
        max={duration}
        step={0.01}
        value={playhead}
        onChange={(e) => scrub(parseFloat(e.target.value))}
        className="flex-1"
      />
      <select
        value={speed}
        onChange={(e) => setSpeed(parseFloat(e.target.value))}
        className="bg-neutral-700 px-1"
      >
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={2}>2x</option>
      </select>
      <span>
        {playhead.toFixed(2)} / {duration.toFixed(2)}
      </span>
    </div>
  );
}
