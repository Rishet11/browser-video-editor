import { describe, it, expect } from "vitest";
import { parseSuggestions, buildSuggestionPrompt, analyseTiming } from "./suggestions";
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

  it("drops a suggestion identical to the element's current start/duration", () => {
    const edl = makeEdl();
    const raw = JSON.stringify({
      suggestions: [{ elementId: "el-1", suggestedStart: 0, suggestedDuration: 2, reason: "no-op" }],
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

describe("buildSuggestionPrompt", () => {
  function makeTwoLayerEdl(): EDL {
    return {
      id: "e2",
      name: "Two Layer",
      duration: 10,
      width: 1920,
      height: 1080,
      layers: [
        {
          id: "bg",
          name: "Background",
          index: 0,
          elements: [
            { id: "bg-video-1", layerId: "bg", type: "video", start: 0, duration: 8, trimIn: 0, props: { src: "bg.mp4" } },
          ],
        },
        {
          id: "overlay",
          name: "Overlay",
          index: 1,
          elements: [
            { id: "overlay-image-1", layerId: "overlay", type: "image", start: 1, duration: 3, trimIn: 0, props: { src: "logo.png" } },
          ],
        },
      ],
    };
  }

  it("includes each layer's identity (id and name)", () => {
    const prompt = buildSuggestionPrompt(makeTwoLayerEdl());
    expect(prompt).toContain("bg");
    expect(prompt).toContain("Background");
    expect(prompt).toContain("overlay");
    expect(prompt).toContain("Overlay");
  });

  it("groups elements under their own layer's line", () => {
    const prompt = buildSuggestionPrompt(makeTwoLayerEdl());
    const lines = prompt.split("\n");
    const bgLine = lines.find((l) => l.includes("Background") && l.includes("bg-video-1"));
    const overlayLine = lines.find((l) => l.includes("Overlay") && l.includes("overlay-image-1"));
    expect(bgLine).toBeTruthy();
    expect(overlayLine).toBeTruthy();
    // elements must not bleed into the other layer's line
    expect(bgLine).not.toContain("overlay-image-1");
    expect(overlayLine).not.toContain("bg-video-1");
  });

  it("states that cross-layer overlap is expected compositing, not a defect", () => {
    const prompt = buildSuggestionPrompt(makeTwoLayerEdl());
    expect(prompt.toLowerCase()).toContain("different layers");
    expect(prompt.toLowerCase()).toContain("expected to overlap");
    expect(prompt.toLowerCase()).toContain("same layer");
  });

  it("includes the computed timing facts in the prompt text", () => {
    // bg-video-1: 0..8, no overshoot given duration 10. Use an EDL with a
    // real overshoot and dead air to check the facts surface verbatim.
    const edl: EDL = {
      id: "e3",
      name: "Facts",
      duration: 15,
      width: 1920,
      height: 1080,
      layers: [
        {
          id: "layer-1",
          name: "Background",
          index: 0,
          elements: [
            { id: "bg-video-1", layerId: "layer-1", type: "video", start: 7, duration: 6, trimIn: 0, props: {} },
          ],
        },
      ],
    };
    const facts = analyseTiming(edl);
    const prompt = buildSuggestionPrompt(edl);
    expect(facts.deadAir.some((d) => d.start === 13 && d.duration === 2)).toBe(true);
    expect(prompt).toContain("13s to 15s");
    expect(prompt).toContain("2s of dead air");
  });
});

describe("analyseTiming", () => {
  function edlWith(elements: { id: string; layerId: string; start: number; duration: number }[][], duration: number): EDL {
    return {
      id: "t",
      name: "Timing",
      duration,
      width: 100,
      height: 100,
      layers: elements.map((els, i) => ({
        id: `layer-${i}`,
        name: `Layer ${i}`,
        index: i,
        elements: els.map((e) => ({
          id: e.id,
          layerId: e.layerId,
          type: "video" as const,
          start: e.start,
          duration: e.duration,
          trimIn: 0,
          props: {},
        })),
      })),
    };
  }

  it("reports an element ending past edl.duration with the correct overshoot", () => {
    const edl = edlWith([[{ id: "a", layerId: "layer-0", start: 7, duration: 6 }]], 10);
    const facts = analyseTiming(edl);
    expect(facts.overshoots).toEqual([{ elementId: "a", end: 13, overshoot: 3 }]);
  });

  it("reports two elements overlapping on the SAME layer as an overlap", () => {
    const edl = edlWith(
      [
        [
          { id: "a", layerId: "layer-0", start: 0, duration: 5 },
          { id: "b", layerId: "layer-0", start: 3, duration: 5 },
        ],
      ],
      20,
    );
    const facts = analyseTiming(edl);
    expect(facts.overlaps).toHaveLength(1);
    expect(facts.overlaps[0]).toMatchObject({ aId: "a", bId: "b", overlapStart: 3, overlapEnd: 5 });
  });

  it("does NOT report elements overlapping on DIFFERENT layers", () => {
    const edl = edlWith(
      [
        [{ id: "a", layerId: "layer-0", start: 0, duration: 5 }],
        [{ id: "b", layerId: "layer-1", start: 3, duration: 5 }],
      ],
      20,
    );
    const facts = analyseTiming(edl);
    expect(facts.overlaps).toEqual([]);
  });

  it("finds dead air between two elements", () => {
    const edl = edlWith(
      [
        [
          { id: "a", layerId: "layer-0", start: 0, duration: 2 },
          { id: "b", layerId: "layer-0", start: 5, duration: 2 },
        ],
      ],
      7,
    );
    const facts = analyseTiming(edl);
    expect(facts.deadAir).toContainEqual({ start: 2, duration: 3 });
  });

  it("finds dead air at the end of the composition (coverage ends at 13, duration 15)", () => {
    const edl = edlWith(
      [
        [
          { id: "a", layerId: "layer-0", start: 0, duration: 7 },
          { id: "b", layerId: "layer-0", start: 7, duration: 6 },
        ],
      ],
      15,
    );
    const facts = analyseTiming(edl);
    expect(facts.deadAir).toContainEqual({ start: 13, duration: 2 });
  });

  it("reports no defects for full coverage with no overlaps", () => {
    const edl = edlWith(
      [
        [
          { id: "a", layerId: "layer-0", start: 0, duration: 5 },
          { id: "b", layerId: "layer-0", start: 5, duration: 5 },
        ],
      ],
      10,
    );
    const facts = analyseTiming(edl);
    expect(facts.overlaps).toEqual([]);
    expect(facts.overshoots).toEqual([]);
    expect(facts.deadAir).toEqual([]);
  });
});
