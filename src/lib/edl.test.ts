import { describe, it, expect } from "vitest";
import {
  resolveAt,
  moveElement,
  trimElement,
  splitElement,
  MIN_DURATION,
  type EDL,
} from "./edl";

function makeEdl(): EDL {
  return {
    id: "e1",
    name: "test",
    duration: 20,
    width: 1920,
    height: 1080,
    layers: [
      {
        id: "l0",
        name: "bottom",
        index: 0,
        elements: [
          { id: "a", layerId: "l0", type: "text", start: 0, duration: 5, trimIn: 0, props: {} },
        ],
      },
      {
        id: "l1",
        name: "top",
        index: 1,
        elements: [
          { id: "b", layerId: "l1", type: "video", start: 2, duration: 6, trimIn: 3, props: {} },
        ],
      },
    ],
  };
}

describe("resolveAt", () => {
  it("includes an element inside its window", () => {
    const edl = makeEdl();
    const visible = resolveAt(edl, 1);
    expect(visible.some((e) => e.id === "a")).toBe(true);
  });

  it("excludes an element outside its window", () => {
    const edl = makeEdl();
    const visible = resolveAt(edl, 10);
    expect(visible.some((e) => e.id === "a")).toBe(false);
    expect(visible.some((e) => e.id === "b")).toBe(false);
  });

  it("includes the boundary exactly at start (inclusive)", () => {
    const edl = makeEdl();
    const visible = resolveAt(edl, 2);
    expect(visible.some((e) => e.id === "b")).toBe(true);
  });

  it("excludes the boundary exactly at start + duration (exclusive)", () => {
    const edl = makeEdl();
    const visible = resolveAt(edl, 5);
    expect(visible.some((e) => e.id === "a")).toBe(false);
  });

  it("computes video localTime including trimIn", () => {
    const edl = makeEdl();
    const visible = resolveAt(edl, 4);
    const b = visible.find((e) => e.id === "b")!;
    expect(b.localTime).toBe(3 + (4 - 2));
  });

  it("computes text localTime without trimIn", () => {
    const edl = makeEdl();
    const visible = resolveAt(edl, 3);
    const a = visible.find((e) => e.id === "a")!;
    expect(a.localTime).toBe(3 - 0);
  });

  it("orders elements by layer index ascending (top layer last)", () => {
    const edl = makeEdl();
    const visible = resolveAt(edl, 3);
    const ids = visible.map((e) => e.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("returns an empty array for an EDL with no layers", () => {
    const empty: EDL = { id: "e", name: "empty", duration: 0, width: 1, height: 1, layers: [] };
    expect(resolveAt(empty, 0)).toEqual([]);
  });

  it("does not mutate the input EDL", () => {
    const edl = makeEdl();
    const snapshot = JSON.stringify(edl);
    resolveAt(edl, 3);
    expect(JSON.stringify(edl)).toBe(snapshot);
  });
});

describe("moveElement", () => {
  it("sets the new start", () => {
    const edl = makeEdl();
    const result = moveElement(edl, "a", 10);
    const a = result.layers[0].elements.find((e) => e.id === "a")!;
    expect(a.start).toBe(10);
  });

  it("rejects a negative start, returning the identical input reference", () => {
    const edl = makeEdl();
    const result = moveElement(edl, "a", -1);
    expect(result).toBe(edl);
  });

  it("rounds a fractional start to millisecond precision", () => {
    const edl = makeEdl();
    const result = moveElement(edl, "a", 7.219075527362293);
    const a = result.layers[0].elements.find((e) => e.id === "a")!;
    expect(a.start).toBe(7.219);
  });

  it("rejects a move that would push start + duration past the composition duration", () => {
    const edl = makeEdl();
    const result = moveElement(edl, "a", 16); // 16 + 5 = 21 > 20
    expect(result).toBe(edl);
  });

  it("allows a move that lands exactly at the composition duration boundary", () => {
    const edl = makeEdl();
    const result = moveElement(edl, "a", 15); // 15 + 5 = 20 === edl.duration
    const a = result.layers[0].elements.find((e) => e.id === "a")!;
    expect(a.start).toBe(15);
  });
});

describe("trimElement", () => {
  it("left-edge trim shifts start, trimIn and duration together", () => {
    const edl = makeEdl();
    const result = trimElement(edl, "b", "start", 1);
    const b = result.layers[1].elements.find((e) => e.id === "b")!;
    expect(b.start).toBe(3);
    expect(b.trimIn).toBe(4);
    expect(b.duration).toBe(5);
  });

  it("right-edge trim changes only duration", () => {
    const edl = makeEdl();
    const result = trimElement(edl, "b", "end", 1);
    const b = result.layers[1].elements.find((e) => e.id === "b")!;
    expect(b.start).toBe(2);
    expect(b.trimIn).toBe(3);
    expect(b.duration).toBe(7);
  });

  it("rejects a trim that would drop duration below MIN_DURATION", () => {
    const edl = makeEdl();
    const result = trimElement(edl, "b", "end", -(6 - MIN_DURATION) - 0.1);
    expect(result).toBe(edl);
  });

  it("rejects a start-edge trim that would make start negative", () => {
    const edl = makeEdl();
    const result = trimElement(edl, "b", "start", -3);
    expect(result).toBe(edl);
  });

  it("rounds a fractional start-edge delta to millisecond precision, including trimIn", () => {
    const edl = makeEdl();
    const result = trimElement(edl, "b", "start", 0.1111119);
    const b = result.layers[1].elements.find((e) => e.id === "b")!;
    expect(b.start).toBe(2.111);
    expect(b.trimIn).toBe(3.111);
    expect(b.duration).toBe(5.889);
  });

  it("rounds a fractional end-edge delta to millisecond precision", () => {
    const edl = makeEdl();
    const result = trimElement(edl, "b", "end", 0.1234567);
    const b = result.layers[1].elements.find((e) => e.id === "b")!;
    expect(b.duration).toBe(6.123);
  });

  it("rejects an end-edge trim that would push start + duration past the composition duration", () => {
    const edl = makeEdl();
    const result = trimElement(edl, "b", "end", 12.1); // start 2 + duration 18.1 = 20.1 > 20
    expect(result).toBe(edl);
  });

  it("allows an end-edge trim that lands exactly at the composition duration boundary", () => {
    const edl = makeEdl();
    const result = trimElement(edl, "b", "end", 12); // start 2 + duration 18 === edl.duration
    const b = result.layers[1].elements.find((e) => e.id === "b")!;
    expect(b.duration).toBe(18);
  });
});

describe("splitElement", () => {
  it("the two halves' durations sum to the original", () => {
    const edl = makeEdl();
    const result = splitElement(edl, "b", 5);
    const elements = result.layers[1].elements;
    expect(elements).toHaveLength(2);
    const sum = elements.reduce((acc, e) => acc + e.duration, 0);
    expect(sum).toBe(6);
  });

  it("second half's trimIn accounts for the shift from the split point", () => {
    const edl = makeEdl();
    const result = splitElement(edl, "b", 5);
    const [, second] = result.layers[1].elements;
    expect(second.trimIn).toBe(3 + (5 - 2));
  });

  it("the two halves have different ids", () => {
    const edl = makeEdl();
    const result = splitElement(edl, "b", 5);
    const [first, second] = result.layers[1].elements;
    expect(first.id).not.toBe(second.id);
  });

  it("rejects an atTime outside the element's window", () => {
    const edl = makeEdl();
    const result = splitElement(edl, "b", 100);
    expect(result).toBe(edl);
  });

  it("rejects a split that would leave a half under MIN_DURATION", () => {
    const edl = makeEdl();
    const result = splitElement(edl, "b", 2.1);
    expect(result).toBe(edl);
  });

  it("rounds a fractional split time to millisecond precision", () => {
    const edl = makeEdl();
    const result = splitElement(edl, "b", 4.123456789);
    const [first, second] = result.layers[1].elements;
    expect(first.duration).toBe(2.123);
    expect(second.start).toBe(4.123);
    expect(second.trimIn).toBe(5.123);
    expect(second.duration).toBe(3.877);
  });
});
