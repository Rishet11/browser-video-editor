"use client";

import { useCallback, useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import { resolveAt, type EDL, type VisibleElement } from "@/lib/edl";
import { needsSeek, idsToPause } from "@/lib/videoSync";

// Module-level playback state: shared singleton across all hook consumers (Stage,
// PlaybackControls, etc.). If this lived in per-call useRefs, the video registry
// in Stage would differ from the one the rAF tick reads, and sync would fail silently.
// Exactly one rAF loop and one video map for the whole app.
let rafId: number | null = null;
let lastTs: number | null = null;
const videoRefs = new Map<string, HTMLVideoElement>();
let prevVisibleVideoIds = new Set<string>();
// Tracks mounted hook consumers; cleanup tears down the rAF loop only when count hits 0.
let consumerCount = 0;

// Apply seek/play/pause and pause-on-exit rules for the current frame.
// Called from the rAF tick while playing, and once synchronously after a scrub
// (scrubs must move video frames even when paused).
function syncVideos(edl: EDL, t: number, playing: boolean, speed: number) {
  const visible = resolveAt(edl, t);
  const visibleVideos = visible.filter((v): v is VisibleElement => v.type === "video");
  const currentIds = new Set(visibleVideos.map((v) => v.id));

  for (const el of visibleVideos) {
    const video = videoRefs.get(el.id);
    if (!video) continue;
    const target = el.localTime;
    if (needsSeek(video.currentTime, target)) {
      video.currentTime = target;
    }
    video.playbackRate = speed;
    if (playing && video.paused) {
      void video.play().catch(() => {});
    }
    if (!playing && !video.paused) {
      video.pause();
    }
  }

  for (const id of idsToPause(prevVisibleVideoIds, currentIds)) {
    const video = videoRefs.get(id);
    if (video && !video.paused) video.pause();
  }

  prevVisibleVideoIds = currentIds;
}

function cancelFrame() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastTs = null;
}

function tick(now: number) {
  const { present, playing, speed, playhead, setPlayhead, setPlaying } = useEditorStore.getState();

  if (!present || !playing) {
    cancelFrame();
    return;
  }

  if (lastTs === null) {
    lastTs = now;
  }
  const dt = ((now - lastTs) * speed) / 1000;
  lastTs = now;

  const next = Math.min(Math.max(playhead + dt, 0), present.duration);
  setPlayhead(next);
  syncVideos(present, next, true, speed);

  if (next >= present.duration) {
    setPlaying(false);
    cancelFrame();
    return;
  }

  rafId = requestAnimationFrame(tick);
}

// Drive playhead via a single rAF loop. Reads live store state inside the tick
// (useEditorStore.getState()) instead of capturing it in closure, so the effect
// never re-runs when playing/speed/playhead change.
export function usePlayback() {
  const play = useCallback(() => {
    const { present, playing } = useEditorStore.getState();
    if (!present || playing) return;
    useEditorStore.getState().setPlaying(true);
    lastTs = null;
    if (rafId === null) {
      rafId = requestAnimationFrame(tick);
    }
  }, []);

  const pause = useCallback(() => {
    useEditorStore.getState().setPlaying(false);
    cancelFrame();
  }, []);

  const stop = useCallback(() => {
    const { present } = useEditorStore.getState();
    useEditorStore.getState().setPlaying(false);
    cancelFrame();
    useEditorStore.getState().setPlayhead(0);
    // Pause every registered video and reset it to its trim-in point.
    for (const [id, video] of videoRefs) {
      video.pause();
      if (present) {
        const el = present.layers.flatMap((l) => l.elements).find((e) => e.id === id);
        if (el) video.currentTime = el.trimIn;
      }
    }
    prevVisibleVideoIds = new Set();
  }, []);

  const scrub = useCallback((t: number) => {
    const { present, setPlayhead, playing, speed } = useEditorStore.getState();
    const duration = present?.duration ?? 0;
    const next = Math.min(Math.max(t, 0), duration);
    setPlayhead(next);
    if (present) {
      syncVideos(present, next, playing, speed);
    }
  }, []);

  const setSpeed = useCallback((speed: number) => {
    useEditorStore.getState().setSpeed(speed);
  }, []);

  const registerVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el === null) {
      videoRefs.delete(id);
    } else {
      videoRefs.set(id, el);
    }
  }, []);

  // The rAF loop and video registry are module singletons, shared by all hook consumers
  // (Stage, PlaybackControls, Timeline). Can't just cancel on unmount—the first
  // consumer to unmount would stop playback for the rest. Count consumers, tear down
  // only when the last one goes away.
  useEffect(() => {
    consumerCount += 1;
    return () => {
      consumerCount -= 1;
      if (consumerCount <= 0) {
        consumerCount = 0;
        cancelFrame();
      }
    };
  }, [cancelFrame]);

  return { play, pause, stop, scrub, setSpeed, registerVideoRef };
}
