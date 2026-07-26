import { describe, it, expect } from "vitest";
import { parseSuggestions } from "./suggestions";
import type { EDL } from "./edl";

function makeEdl(): EDL {
  return {
    id: "e1",
    name: "Test",
    duration: 10,
    width: 1920,
    height: 1080,
    layers: [
      {
        id: "l1",
        name: "Layer 1",
        index: 0,
        elements: [
          { id: "el-1", layerId: "l1", type: "text", start: 0, duration: 2, trimIn: 0, props: {} },
          { id: "el-2", layerId: "l1", type: "video", start: 2, duration: 3, trimIn: 0, props: {} },
        ],
      },
    ],
  };
}

describe("parseSuggestions", () => {
  it("parses a valid {suggestions:[...]} response", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        { elementId: "el-1", suggestedStart: 0.5, suggestedDuration: 1.5, reason: "starts late" },
      ],
    });
    const result = parseSuggestions(raw, edl);
    expect(result).toHaveLength(1);
    expect(result[0].elementId).toBe("el-1");
    expect(result[0].suggestedStart).toBe(0.5);
  });

  it("parses a bare-array response", () => {
    const edl = makeEdl();
    const raw = JSON.stringify([
      { elementId: "el-1", suggestedStart: 1, suggestedDuration: 1, reason: "x" },
    ]);
    const result = parseSuggestions(raw, edl);
    expect(result).toHaveLength(1);
  });

  it("strips a ```json fence before parsing", () => {
    const edl = makeEdl();
    const raw = "```json\n" + JSON.stringify({ suggestions: [{ elementId: "el-1", suggestedStart: 1, suggestedDuration: 1, reason: "x" }] }) + "\n```";
    const result = parseSuggestions(raw, edl);
    expect(result).toHaveLength(1);
  });

  it("returns [] on malformed JSON without throwing", () => {
    expect(() => parseSuggestions("not json {{{", makeEdl())).not.toThrow();
    expect(parseSuggestions("not json {{{", makeEdl())).toEqual([]);
  });

  it("drops entries with unknown elementId", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [{ elementId: "does-not-exist", suggestedStart: 1, suggestedDuration: 1, reason: "x" }],
    });
    expect(parseSuggestions(raw, edl)).toEqual([]);
  });

  it("drops suggestedDuration below MIN_DURATION (0.2)", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [{ elementId: "el-1", suggestedStart: 0, suggestedDuration: 0.2, reason: "x" }],
    });
    expect(parseSuggestions(raw, edl)).toEqual([]);
  });

  it("drops negative suggestedStart", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [{ elementId: "el-1", suggestedStart: -1, suggestedDuration: 1, reason: "x" }],
    });
    expect(parseSuggestions(raw, edl)).toEqual([]);
  });

  it("drops suggestions exceeding edl.duration", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [{ elementId: "el-1", suggestedStart: 9, suggestedDuration: 5, reason: "x" }],
    });
    expect(parseSuggestions(raw, edl)).toEqual([]);
  });

  it("coerces numeric strings to numbers", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [{ elementId: "el-1", suggestedStart: "0.5", suggestedDuration: "1.5", reason: "x" }],
    });
    const result = parseSuggestions(raw, edl);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedStart).toBe(0.5);
    expect(result[0].suggestedDuration).toBe(1.5);
  });

  it("drops NaN and Infinity values", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        { elementId: "el-1", suggestedStart: NaN, suggestedDuration: 1, reason: "x" },
      ],
    });
    // NaN serializes to null in JSON.stringify, simulate directly
    const raw2 = '{"suggestions":[{"elementId":"el-1","suggestedStart":Infinity,"suggestedDuration":1,"reason":"x"}]}';
    expect(parseSuggestions(raw, edl)).toEqual([]);
    expect(parseSuggestions(raw2, edl)).toEqual([]);
  });

  it("dedupes by elementId, keeping the first", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        { elementId: "el-1", suggestedStart: 0.5, suggestedDuration: 1, reason: "first" },
        { elementId: "el-1", suggestedStart: 1, suggestedDuration: 2, reason: "second" },
      ],
    });
    const result = parseSuggestions(raw, edl);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("first");
  });

  it("rounds to 2 decimal places", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [{ elementId: "el-1", suggestedStart: 0.123456, suggestedDuration: 1.987654, reason: "x" }],
    });
    const result = parseSuggestions(raw, edl);
    expect(result[0].suggestedStart).toBe(0.12);
    expect(result[0].suggestedDuration).toBe(1.99);
  });
});
