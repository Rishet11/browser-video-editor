"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store";

/**
 * Drives the playhead via a single rAF loop. Reads live state from the
 * Zustand store inside the tick (useEditorStore.getState()) instead of
 * capturing playing/speed/playhead in the callback's closure, so the effect
 * never needs to re-run when those values change.
 */
export function usePlayback() {
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const cancelFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTsRef.current = null;
  }, []);

  const tick = useCallback(
    (now: number) => {
      const { present, playing, speed, playhead, setPlayhead, setPlaying } =
        useEditorStore.getState();

      if (!present || !playing) {
        cancelFrame();
        return;
      }

      if (lastTsRef.current === null) {
        lastTsRef.current = now;
      }
      const dt = ((now - lastTsRef.current) * speed) / 1000;
      lastTsRef.current = now;

      const next = Math.min(Math.max(playhead + dt, 0), present.duration);
      setPlayhead(next);

      if (next >= present.duration) {
        setPlaying(false);
        cancelFrame();
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [cancelFrame],
  );

  const play = useCallback(() => {
    const { present, playing } = useEditorStore.getState();
    if (!present || playing) return;
    useEditorStore.getState().setPlaying(true);
    lastTsRef.current = null;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  const pause = useCallback(() => {
    useEditorStore.getState().setPlaying(false);
    cancelFrame();
  }, [cancelFrame]);

  const stop = useCallback(() => {
    useEditorStore.getState().setPlaying(false);
    cancelFrame();
    useEditorStore.getState().setPlayhead(0);
  }, [cancelFrame]);

  const scrub = useCallback((t: number) => {
    const { present, setPlayhead } = useEditorStore.getState();
    const duration = present?.duration ?? 0;
    setPlayhead(Math.min(Math.max(t, 0), duration));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    useEditorStore.getState().setSpeed(speed);
  }, []);

  const registerVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el === null) {
      videoRefs.current.delete(id);
    } else {
      videoRefs.current.set(id, el);
    }
  }, []);

  useEffect(() => {
    return () => cancelFrame();
  }, [cancelFrame]);

  return { play, pause, stop, scrub, setSpeed, registerVideoRef };
}
