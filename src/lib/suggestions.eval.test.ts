/**
 * Eval test, NOT a unit test of correctness in general.
 *
 * This exercises parseSuggestions plus manual application against ONE
 * hand-built, known-defect fixture (two overlapping elements on one layer).
 * It does NOT call the model (requestSuggestions is never invoked here) and
 * does NOT prove the model detects overlaps in general, or any other class
 * of timing defect, on arbitrary compositions. It also does NOT prove that
 * parseSuggestions verifies a suggestion actually fixes anything: by design,
 * parseSuggestions only validates shape/range of a response, it has no idea
 * whether a given suggestion helps or hurts the composition (see case 3
 * below, where a passing suggestion leaves the defect in place).
 */
import { describe, it, expect } from "vitest";
import { parseSuggestions } from "./suggestions";
import { resolveAt } from "./edl";
import type { EDL } from "./edl";

function makeOverlapEdl(): EDL {
  return {
    id: "e1",
    name: "Overlap fixture",
    duration: 6,
    width: 1920,
    height: 1080,
    layers: [
      {
        id: "l1",
        name: "Layer 1",
        index: 0,
        elements: [
          { id: "el-1", layerId: "l1", type: "video", start: 0, duration: 3, trimIn: 0, props: {} },
          { id: "el-2", layerId: "l1", type: "video", start: 2, duration: 3, trimIn: 0, props: {} },
        ],
      },
    ],
  };
}

/** Samples resolveAt every 0.1s across the composition; true if two elements
 * from the SAME layer are simultaneously visible at any sample. */
function hasOverlap(edl: EDL): boolean {
  for (let t = 0; t < edl.duration; t += 0.1) {
    const visible = resolveAt(edl, t);
    const byLayer = new Map<string, number>();
    for (const el of visible) {
      byLayer.set(el.layerId, (byLayer.get(el.layerId) ?? 0) + 1);
    }
    for (const count of byLayer.values()) {
      if (count > 1) return true;
    }
  }
  return false;
}

describe("suggestions eval: overlap fixture", () => {
  it("case 1: the fixture genuinely has the overlap defect it claims", () => {
    expect(hasOverlap(makeOverlapEdl())).toBe(true);
  });

  it("case 2: a valid canned response that fixes the overlap survives parseSuggestions and clears the defect", () => {
    const edl = makeOverlapEdl();
    const cannedResponse = JSON.stringify({
      suggestions: [
        { elementId: "el-2", suggestedStart: 3, suggestedDuration: 3, reason: "starts after el-1 ends, removing the overlap" },
      ],
    });
    const result = parseSuggestions(cannedResponse, edl);
    expect(result).toHaveLength(1);

    const suggestion = result[0];
    const patched: EDL = {
      ...edl,
      layers: edl.layers.map((l) => ({
        ...l,
        elements: l.elements.map((el) =>
          el.id === suggestion.elementId
            ? { ...el, start: suggestion.suggestedStart, duration: suggestion.suggestedDuration }
            : el,
        ),
      })),
    };
    expect(hasOverlap(patched)).toBe(false);
  });

  it("case 3: a valid but insufficient canned response passes parseSuggestions yet leaves the overlap in place", () => {
    const edl = makeOverlapEdl();
    const cannedResponse = JSON.stringify({
      suggestions: [
        { elementId: "el-2", suggestedStart: 2.5, suggestedDuration: 3, reason: "nudges start slightly later" },
      ],
    });
    const result = parseSuggestions(cannedResponse, edl);
    expect(result).toHaveLength(1);

    const suggestion = result[0];
    const patched: EDL = {
      ...edl,
      layers: edl.layers.map((l) => ({
        ...l,
        elements: l.elements.map((el) =>
          el.id === suggestion.elementId
            ? { ...el, start: suggestion.suggestedStart, duration: suggestion.suggestedDuration }
            : el,
        ),
      })),
    };
    expect(hasOverlap(patched)).toBe(true);
  });
});
