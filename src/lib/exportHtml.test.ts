import { describe, it, expect } from "vitest";
import { renderStandaloneHtml, serializeForScript } from "./exportHtml";
import type { EDL } from "./edl";

const baseEdl: EDL = {
  id: "comp-1",
  name: "My Composition",
  duration: 10,
  width: 1280,
  height: 720,
  layers: [
    {
      id: "layer-1",
      name: "Layer 1",
      index: 0,
      elements: [
        {
          id: "el-text-1",
          layerId: "layer-1",
          type: "text",
          start: 1,
          duration: 3,
          trimIn: 0,
          props: { text: "Hello", x: 10, y: 10, w: 200, h: 50 },
        },
        {
          id: "el-video-1",
          layerId: "layer-1",
          type: "video",
          start: 0,
          duration: 5,
          trimIn: 2,
          props: { src: "video.mp4", x: 0, y: 0, w: 1280, h: 720 },
        },
      ],
    },
  ],
};

describe("renderStandaloneHtml", () => {
  const html = renderStandaloneHtml(baseEdl);

  it("contains a doctype", () => {
    expect(html.toLowerCase()).toContain("<!doctype html");
  });

  it("contains a #stage element", () => {
    expect(html).toContain('id="stage"');
  });

  it("contains the mirror comment verbatim", () => {
    expect(html).toContain(
      "// mirrors src/lib/edl.ts resolveAt + src/lib/videoSync.ts — keep in sync",
    );
  });

  it("embeds an EDL that round-trips via JSON.parse", () => {
    const match = html.match(/const EDL = (.*);/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed).toEqual(baseEdl);
  });

  it("includes SEEK_TOLERANCE 0.15", () => {
    expect(html).toContain("0.15");
  });

  it("includes every element id", () => {
    expect(html).toContain("el-text-1");
    expect(html).toContain("el-video-1");
  });

  it("uses textContent, not innerHTML, for text elements", () => {
    expect(html).toContain("textContent");
    expect(html).not.toContain(".innerHTML = ");
  });
});

describe("serializeForScript", () => {
  it("escapes </script> so it never appears literally", () => {
    const payload = "</script><script>alert(1)</script>";
    const serialized = serializeForScript({ text: payload });
    expect(serialized).not.toContain("</script>");
  });

  it("round-trips through JSON.parse", () => {
    const value = { a: 1, b: "hello </script> world", c: [1, 2, 3] };
    const serialized = serializeForScript(value);
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it("produces output safe to embed in a script tag", () => {
    const edlWithInjection: EDL = {
      ...baseEdl,
      layers: [
        {
          ...baseEdl.layers[0],
          elements: [
            {
              id: "el-injection",
              layerId: "layer-1",
              type: "text",
              start: 0,
              duration: 1,
              trimIn: 0,
              props: { text: "</script><script>alert(1)</script>", x: 0, y: 0, w: 1, h: 1 },
            },
          ],
        },
      ],
    };
    const output = renderStandaloneHtml(edlWithInjection);
    expect(output).not.toContain("</script><script>alert(1)</script>");

    const match = output.match(/const EDL = (.*);/);
    const parsed = JSON.parse(match![1]);
    expect(parsed.layers[0].elements[0].props.text).toBe(
      "</script><script>alert(1)</script>",
    );
  });
});
