// Shared validation. Dependency-free so client and server import the same
// source and can't diverge.
import { MIN_DURATION } from "./edl";

export function isValidStart(start: number): boolean {
  return Number.isFinite(start) && start >= 0;
}

export function isValidDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration >= MIN_DURATION;
}
