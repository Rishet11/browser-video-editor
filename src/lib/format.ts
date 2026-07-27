/**
 * Display-only number formatting for timeline values (start/duration/trimIn).
 *
 * Two decimal places, trailing zeros trimmed, so 7.219075527362293 -> "7.22"
 * and 7 -> "7". Never used for stored/computed values, only for rendering.
 */
export function formatSeconds(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
