/**
 * Pure decision logic for video playback sync. No DOM access, testable
 * without a browser.
 *
 * Seeks are asynchronous and not sample-accurate, so issuing one every frame
 * means the decoder never plays a smooth run and the picture visibly
 * stutters. Below 0.15s of drift the browser's own clock is a better clock
 * than ours; past it, we correct. Scrub jumps exceed the tolerance
 * immediately and so self-correct on the next frame.
 */
export const SEEK_TOLERANCE = 0.15;

/** Returns whether a hard seek is warranted for the given drift. */
export function needsSeek(currentTime: number, target: number, tolerance = SEEK_TOLERANCE): boolean {
  return Math.abs(currentTime - target) > tolerance;
}

/** Given previous and current visible video ids, returns which ids must be paused. */
export function idsToPause(prev: Iterable<string>, current: Iterable<string>): string[] {
  const currentSet = new Set(current);
  const result: string[] = [];
  for (const id of prev) {
    if (!currentSet.has(id)) result.push(id);
  }
  return result;
}
