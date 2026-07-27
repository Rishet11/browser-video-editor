import { describe, it, expect } from "vitest";
import { formatSeconds } from "./format";

describe("formatSeconds", () => {
  it("rounds a long float to two decimals", () => {
    expect(formatSeconds(7.219075527362293)).toBe("7.22");
  });

  it("trims trailing zeros for a whole number", () => {
    expect(formatSeconds(7)).toBe("7");
  });

  it("keeps a single significant decimal", () => {
    expect(formatSeconds(7.5)).toBe("7.5");
  });

  it("formats zero", () => {
    expect(formatSeconds(0)).toBe("0");
  });
});
