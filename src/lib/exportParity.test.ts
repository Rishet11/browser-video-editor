/**
 * The test that keeps the central architectural claim honest.
 *
 * The exported HTML carries a hand-written vanilla-JS copy of `resolveAt`, because
 * the exported file has no bundler and no imports. A copy is a liability: it can
 * silently drift from the TypeScript original, and if it does, the claim that
 * "preview and export cannot drift" becomes false while everything still compiles
 * and every other test still passes.
 *
 * So this extracts the vanilla implementation out of the generated document,
 * evaluates it, and runs it head-to-head against the real `resolveAt` over the same
 * EDL at the same timestamps — including the exact window boundaries, which is
 * where an off-by-one in a reimplementation would actually show up.
 */
import { describe, expect, it } from "vitest";
import { resolveAt, type EDL } from "./edl";
import { renderStandaloneHtml } from "./exportHtml";

const EDL_FIXTURE: EDL = {
  id: "parity",
  name: "Parity fixture",
  duration: 20,
  width: 1920,
  height: 1080,
  layers: [
    {
      id: "top",
      name: "Top",
      index: 2,
      elements: [
        {
          id: "caption",
          layerId: "top",
          type: "text",
          start: 5,
          duration: 4,
          trimIn: 0,
          props: { x: 10, y: 20, w: 500, h: 80, text: "caption" },
        },
      ],
    },
    {
      id: "bottom",
      name: "Bottom",
      index: 0,
      elements: [
        {
          id: "bg",
          layerId: "bottom",
          type: "image",
          start: 0,
          duration: 20,
          trimIn: 0,
          props: { x: 0, y: 0, w: 1920, h: 1080, src: "/bg.jpg" },
        },
        {
          id: "clip",
          layerId: "bottom",
          type: "video",
          start: 3,
          duration: 6,
          trimIn: 2.5,
          props: { x: 0, y: 0, w: 1920, h: 1080, src: "/clip.mp4" },
        },
      ],
    },
    {
      id: "middle",
      name: "Middle",
      index: 1,
      elements: [
        {
          id: "overlay",
          layerId: "middle",
          type: "image",
          start: 5,
          duration: 10,
          trimIn: 0,
          props: { x: 100, y: 100, w: 400, h: 300, src: "/overlay.jpg" },
        },
      ],
    },
  ],
};

/** Pull the vanilla `resolveAt` out of the generated document and make it callable. */
function extractVanillaResolveAt(html: string): (edl: EDL, t: number) => Array<Record<string, unknown>> {
  const start = html.indexOf("function resolveAt(edl, t) {");
  expect(start, "vanilla resolveAt not found in the exported document").toBeGreaterThan(-1);

  // Walk braces to find the end of the function, rather than regex-matching it.
  const bodyStart = html.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  expect(end, "could not find the end of the vanilla resolveAt").toBeGreaterThan(-1);

  const source = html.slice(start, end);
  const factory = new Function(`${source}; return resolveAt;`);
  return factory() as (edl: EDL, t: number) => Array<Record<string, unknown>>;
}

describe("export mirror parity with lib/edl.ts", () => {
  const html = renderStandaloneHtml(EDL_FIXTURE);
  const vanillaResolveAt = extractVanillaResolveAt(html);

  // Includes every element's exact start and exact end, plus either side of them.
  const timestamps = [
    0, 2.999, 3, 3.001, 4.5, 4.999, 5, 5.001, 8.999, 9, 9.001, 12, 14.999, 15, 15.001,
    19.999, 20, 25, -1,
  ];

  it.each(timestamps)("agrees on which elements are visible at t=%s", (t) => {
    const ts = resolveAt(EDL_FIXTURE, t).map((e) => e.id);
    const vanilla = vanillaResolveAt(EDL_FIXTURE, t).map((e) => e.id as string);
    expect(vanilla).toEqual(ts);
  });

  it.each(timestamps)("agrees on localTime for every visible element at t=%s", (t) => {
    const ts = resolveAt(EDL_FIXTURE, t).map((e) => [e.id, e.localTime]);
    const vanilla = vanillaResolveAt(EDL_FIXTURE, t).map((e) => [e.id, e.localTime]);
    expect(vanilla).toEqual(ts);
  });

  it("agrees at the left boundary, which must be inclusive", () => {
    expect(vanillaResolveAt(EDL_FIXTURE, 3).map((e) => e.id)).toContain("clip");
    expect(resolveAt(EDL_FIXTURE, 3).map((e) => e.id)).toContain("clip");
  });

  it("agrees at the right boundary, which must be exclusive", () => {
    expect(vanillaResolveAt(EDL_FIXTURE, 9).map((e) => e.id)).not.toContain("clip");
    expect(resolveAt(EDL_FIXTURE, 9).map((e) => e.id)).not.toContain("clip");
  });

  it("agrees that video localTime carries trimIn and text localTime does not", () => {
    const t = 6;
    const vanilla = vanillaResolveAt(EDL_FIXTURE, t);
    const clip = vanilla.find((e) => e.id === "clip");
    const caption = vanilla.find((e) => e.id === "caption");
    expect(clip?.localTime).toBe(2.5 + (t - 3));
    expect(caption?.localTime).toBe(t - 5);
    const tsClip = resolveAt(EDL_FIXTURE, t).find((e) => e.id === "clip");
    expect(clip?.localTime).toBe(tsClip?.localTime);
  });

  it("agrees on paint order across layers declared out of index order", () => {
    // Layers are declared index 2, 0, 1; both implementations must sort ascending.
    const ts = resolveAt(EDL_FIXTURE, 6).map((e) => e.id);
    const vanilla = vanillaResolveAt(EDL_FIXTURE, 6).map((e) => e.id);
    expect(ts).toEqual(["bg", "clip", "overlay", "caption"]);
    expect(vanilla).toEqual(ts);
  });
});
