/**
 * Shared validation helpers. Dependency-free (no Prisma, no next/server) so
 * client and server can import from the same source and never diverge.
 */
import { MIN_DURATION } from "./edl";

export function isValidStart(start: number): boolean {
  return Number.isFinite(start) && start >= 0;
}

export function isValidDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration >= MIN_DURATION;
}
