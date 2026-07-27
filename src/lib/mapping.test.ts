import { describe, it, expect } from "vitest";
import { mergeProps } from "./mapping";

describe("mergeProps", () => {
  it("preserves untouched keys", () => {
    expect(mergeProps({ x: 1, y: 2, w: 100 }, { x: 5 })).toEqual({
      x: 5,
      y: 2,
      w: 100,
    });
  });

  it("incoming overwrites existing values", () => {
    expect(mergeProps({ text: "old" }, { text: "new" })).toEqual({
      text: "new",
    });
  });

  it("replaces css wholesale rather than deep-merging it", () => {
    const existing = { css: { color: "red", fontSize: 12 } };
    const incoming = { css: { color: "blue" } };
    expect(mergeProps(existing, incoming)).toEqual({
      css: { color: "blue" },
    });
  });

  it("handles null existing props", () => {
    expect(mergeProps(null, { text: "hi" })).toEqual({ text: "hi" });
  });

  it("handles undefined existing props", () => {
    expect(mergeProps(undefined, { text: "hi" })).toEqual({ text: "hi" });
  });
});
