// Pure video-sync decisions, no DOM, testable without a browser.
//
// Seeks are async and not sample-accurate, so one per frame stutters the
// decoder. Under 0.15s of drift the browser's own clock is better than ours;
// past it we correct. Scrub jumps exceed the tolerance instantly, so they
// self-correct on the next frame.
export const SEEK_TOLERANCE = 0.15;

/** Hard-seek warranted for this much drift? */
export function needsSeek(currentTime: number, target: number, tolerance = SEEK_TOLERANCE): boolean {
  return Math.abs(currentTime - target) > tolerance;
}

/** Ids visible last frame but not this one — these get paused. */
export function idsToPause(prev: Iterable<string>, current: Iterable<string>): string[] {
  const currentSet = new Set(current);
  const result: string[] = [];
  for (const id of prev) {
    if (!currentSet.has(id)) result.push(id);
  }
  return result;
}
