import { describe, it, expect } from "vitest";
import { needsSeek, idsToPause, SEEK_TOLERANCE } from "./videoSync";

describe("needsSeek", () => {
  it("returns false for drift below tolerance", () => {
    expect(needsSeek(1.0, 1.1)).toBe(false);
  });

  it("returns false for drift exactly at tolerance (boundary, > not >=)", () => {
    expect(needsSeek(1.0, 1.0 + SEEK_TOLERANCE)).toBe(false);
  });

  it("returns true for drift just above tolerance", () => {
    expect(needsSeek(1.0, 1.0 + SEEK_TOLERANCE + 0.001)).toBe(true);
  });

  it("returns true for drift of 0.2", () => {
    expect(needsSeek(1.0, 1.2)).toBe(true);
  });

  it("returns true for negative drift of large magnitude (scrub back)", () => {
    expect(needsSeek(5.0, 2.0)).toBe(true);
  });

  it("returns false for zero drift", () => {
    expect(needsSeek(2.5, 2.5)).toBe(false);
  });
});

describe("idsToPause", () => {
  it("returns ids in prev but not current", () => {
    expect(idsToPause(["a", "b"], ["b", "c"])).toEqual(["a"]);
  });

  it("returns empty when sets are equal", () => {
    expect(idsToPause(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("returns empty when prev is empty", () => {
    expect(idsToPause([], ["a"])).toEqual([]);
  });

  it("returns all prev ids when current is empty", () => {
    expect(idsToPause(["a", "b"], [])).toEqual(["a", "b"]);
  });
});
