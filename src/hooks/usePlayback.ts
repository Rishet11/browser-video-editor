"use client";

import { useCallback, useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import { resolveAt, type EDL, type VisibleElement } from "@/lib/edl";
import { needsSeek, idsToPause } from "@/lib/videoSync";

/**
 * Module-level (singleton) playback state. Both Stage (which registers video
 * refs) and PlaybackControls (which drives play/pause/scrub) call
 * `usePlayback()` independently, as separate hook instances in separate
 * components. If this state lived in per-call `useRef`s, Stage's registered
 * videos would live in a different map than the one the rAF tick in
 * PlaybackControls reads, and sync would silently do nothing. Keeping it at
 * module scope means there is exactly one rAF loop and one video registry for
 * the whole app, which matches there being exactly one Stage on screen.
 */
let rafId: number | null = null;
let lastTs: number | null = null;
const videoRefs = new Map<string, HTMLVideoElement>();
let prevVisibleVideoIds = new Set<string>();
/** How many mounted components currently use this hook. See the cleanup effect. */
let consumerCount = 0;

/**
 * Applies the hard-seek / play-pause / pause-on-exit rules for the given
 * frame. Called from the rAF tick while playing, and once synchronously
 * after a scrub while paused (a scrub must move the video frame even when
 * not playing).
 */
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

/**
 * Drives the playhead via a single rAF loop. Reads live state from the
 * Zustand store inside the tick (useEditorStore.getState()) instead of
 * capturing playing/speed/playhead in the callback's closure, so the effect
 * never needs to re-run when those values change.
 */
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

  /**
   * The rAF loop and the video registry are module-level singletons, shared by
   * every component that calls this hook (Stage, PlaybackControls, Timeline).
   * That means an unmount cleanup cannot just cancel the loop: whichever consumer
   * unmounted first would stop playback for the ones still mounted. So consumers
   * are counted, and the loop is only torn down when the last one goes away.
   */
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
