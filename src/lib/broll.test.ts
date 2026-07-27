import { describe, it, expect } from "vitest";
import { parseBrollSuggestions } from "./broll";
import type { EDL } from "./edl";

function makeEdl(): EDL {
  return {
    id: "e1",
    name: "Test",
    duration: 20,
    width: 1920,
    height: 1080,
    layers: [
      {
        id: "l1",
        name: "Layer 1",
        index: 0,
        elements: [
          { id: "el-1", layerId: "l1", type: "text", start: 0, duration: 2, trimIn: 0, props: {} },
          // gap from 2 to 6 (4s)
          { id: "el-2", layerId: "l1", type: "video", start: 6, duration: 3, trimIn: 0, props: {} },
        ],
      },
    ],
  };
}

describe("parseBrollSuggestions", () => {
  it("parses a valid {suggestions:[...]} response", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-1",
          gapStart: 2,
          gapDuration: 4,
          searchTerms: ["city skyline"],
          shotType: "establishing",
          reason: "dead air before el-2",
        },
      ],
    });
    const result = parseBrollSuggestions(raw, edl);
    expect(result).toHaveLength(1);
    expect(result[0].afterElementId).toBe("el-1");
    expect(result[0].shotType).toBe("establishing");
  });

  it("parses a bare-array response", () => {
    const edl = makeEdl();
    const raw = JSON.stringify([
      {
        afterElementId: "el-1",
        gapStart: 2,
        gapDuration: 4,
        searchTerms: ["ocean waves"],
        shotType: "cutaway",
        reason: "x",
      },
    ]);
    const result = parseBrollSuggestions(raw, edl);
    expect(result).toHaveLength(1);
  });

  it("strips a ```json fence before parsing", () => {
    const edl = makeEdl();
    const raw =
      "```json\n" +
      JSON.stringify({
        suggestions: [
          {
            afterElementId: "el-1",
            gapStart: 2,
            gapDuration: 4,
            searchTerms: ["forest"],
            shotType: "cutaway",
            reason: "x",
          },
        ],
      }) +
      "\n```";
    const result = parseBrollSuggestions(raw, edl);
    expect(result).toHaveLength(1);
  });

  it("returns [] on malformed JSON without throwing", () => {
    expect(() => parseBrollSuggestions("not json {{{", makeEdl())).not.toThrow();
    expect(parseBrollSuggestions("not json {{{", makeEdl())).toEqual([]);
  });

  it("drops entries with unknown afterElementId", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "does-not-exist",
          gapStart: 2,
          gapDuration: 4,
          searchTerms: ["x"],
          shotType: "cutaway",
          reason: "x",
        },
      ],
    });
    expect(parseBrollSuggestions(raw, edl)).toEqual([]);
  });

  it("accepts __start__ as afterElementId", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "__start__",
          gapStart: 2,
          gapDuration: 4,
          searchTerms: ["x"],
          shotType: "cutaway",
          reason: "x",
        },
      ],
    });
    expect(parseBrollSuggestions(raw, edl)).toHaveLength(1);
  });

  it("drops gapDuration below MIN_DURATION (0.2)", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-1",
          gapStart: 2,
          gapDuration: 0.2,
          searchTerms: ["x"],
          shotType: "cutaway",
          reason: "x",
        },
      ],
    });
    expect(parseBrollSuggestions(raw, edl)).toEqual([]);
  });

  it("drops a gap exceeding edl.duration", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-2",
          gapStart: 18,
          gapDuration: 5,
          searchTerms: ["x"],
          shotType: "cutaway",
          reason: "x",
        },
      ],
    });
    expect(parseBrollSuggestions(raw, edl)).toEqual([]);
  });

  it("rejects a hallucinated gap that overlaps a real element", () => {
    const edl = makeEdl();
    // el-2 occupies [6,9); this claims a gap at [7,9) which overlaps it
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-1",
          gapStart: 7,
          gapDuration: 2,
          searchTerms: ["x"],
          shotType: "cutaway",
          reason: "x",
        },
      ],
    });
    expect(parseBrollSuggestions(raw, edl)).toEqual([]);
  });

  it("drops entries with empty searchTerms", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-1",
          gapStart: 2,
          gapDuration: 4,
          searchTerms: [],
          shotType: "cutaway",
          reason: "x",
        },
      ],
    });
    expect(parseBrollSuggestions(raw, edl)).toEqual([]);
  });

  it("drops entries whose searchTerms are all empty/whitespace", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-1",
          gapStart: 2,
          gapDuration: 4,
          searchTerms: ["   ", ""],
          shotType: "cutaway",
          reason: "x",
        },
      ],
    });
    expect(parseBrollSuggestions(raw, edl)).toEqual([]);
  });

  it("coerces out-of-vocabulary shotType to cutaway instead of rejecting", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-1",
          gapStart: 2,
          gapDuration: 4,
          searchTerms: ["x"],
          shotType: "dramatic-zoom",
          reason: "x",
        },
      ],
    });
    const result = parseBrollSuggestions(raw, edl);
    expect(result).toHaveLength(1);
    expect(result[0].shotType).toBe("cutaway");
  });

  it("dedupes by (afterElementId, gapStart) pair, not by afterElementId alone", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-1",
          gapStart: 2,
          gapDuration: 2,
          searchTerms: ["a"],
          shotType: "cutaway",
          reason: "first",
        },
        {
          afterElementId: "el-1",
          gapStart: 2,
          gapDuration: 3,
          searchTerms: ["b"],
          shotType: "cutaway",
          reason: "duplicate pair",
        },
        {
          afterElementId: "el-1",
          gapStart: 2.5,
          gapDuration: 1,
          searchTerms: ["c"],
          shotType: "cutaway",
          reason: "different gapStart, same predecessor",
        },
      ],
    });
    const result = parseBrollSuggestions(raw, edl);
    // first two share (el-1, 2) -> only first kept; third has a different gapStart -> kept
    expect(result).toHaveLength(2);
    expect(result[0].reason).toBe("first");
    expect(result[1].reason).toBe("different gapStart, same predecessor");
  });

  it("rounds gapStart / gapDuration to 2 decimal places", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-1",
          gapStart: 2.123456,
          gapDuration: 1.987654,
          searchTerms: ["x"],
          shotType: "cutaway",
          reason: "x",
        },
      ],
    });
    const result = parseBrollSuggestions(raw, edl);
    expect(result[0].gapStart).toBe(2.12);
    expect(result[0].gapDuration).toBe(1.99);
  });

  it("caps searchTerms at 5 entries and 60 chars each", () => {
    const edl = makeEdl();
    const longTerm = "x".repeat(100);
    const raw = JSON.stringify({
      suggestions: [
        {
          afterElementId: "el-1",
          gapStart: 2,
          gapDuration: 4,
          searchTerms: ["a", "b", "c", "d", "e", "f", longTerm],
          shotType: "cutaway",
          reason: "x",
        },
      ],
    });
    const result = parseBrollSuggestions(raw, edl);
    expect(result[0].searchTerms).toHaveLength(5);
    expect(result[0].searchTerms.every((t) => t.length <= 60)).toBe(true);
  });
});
