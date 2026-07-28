// Display-only formatting for timeline values: 2dp, trailing zeros trimmed
// (7.219075527362293 -> "7.22", 7 -> "7"). Never for stored/computed values.
export function formatSeconds(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
