import { describe, it, expect } from "vitest";
import { parseHtmlToEDL } from "./importHtml";
import { isValidStart, isValidDuration } from "./validate";

describe("parseHtmlToEDL", () => {
  it("parses an <img> into an image element with the right src", () => {
    const edl = parseHtmlToEDL(`<img src="https://example.com/bg.jpg" />`);
    const el = edl.layers[0].elements[0];
    expect(el.type).toBe("image");
    expect(el.props.src).toBe("https://example.com/bg.jpg");
  });

  it("resolves a <video> src from a nested <source>", () => {
    const edl = parseHtmlToEDL(
      `<video><source src="https://example.com/clip.mp4" type="video/mp4" /></video>`,
    );
    const el = edl.layers[0].elements[0];
    expect(el.type).toBe("video");
    expect(el.props.src).toBe("https://example.com/clip.mp4");
  });

  it("prefers video tag's own src over nested source", () => {
    const edl = parseHtmlToEDL(
      `<video src="https://example.com/direct.mp4"><source src="https://example.com/nested.mp4" /></video>`,
    );
    expect(edl.layers[0].elements[0].props.src).toBe("https://example.com/direct.mp4");
  });

  it("decodes HTML entities in a heading's text", () => {
    const edl = parseHtmlToEDL(`<h1>Fish &amp; Chips</h1>`);
    const el = edl.layers[0].elements[0];
    expect(el.type).toBe("text");
    expect(el.props.text).toBe("Fish & Chips");
  });

  it("emits no text element for a container div with no direct text", () => {
    const edl = parseHtmlToEDL(
      `<img src="a.jpg" /><div><p>nested text</p><span>more nested</span></div>`,
    );
    // only the nested <p> and <span> and the <img> should produce elements,
    // not the outer container div
    const types = edl.layers.flatMap((l) => l.elements.map((e) => e.type));
    expect(types).toEqual(["image", "text", "text"]);
  });

  it("never turns <script> or <style> contents into elements", () => {
    const edl = parseHtmlToEDL(
      `<script>var div = "<div>fake</div>";</script><style>.x { color: red; }</style><img src="a.jpg" />`,
    );
    expect(edl.layers.length).toBe(1);
    expect(edl.layers[0].elements[0].type).toBe("image");
  });

  it("maps left/top/width/height px style to x/y/w/h numbers", () => {
    const edl = parseHtmlToEDL(
      `<img src="a.jpg" style="left: 100px; top: 50px; width: 300px; height: 200px;" />`,
    );
    const props = edl.layers[0].elements[0].props;
    expect(props.x).toBe(100);
    expect(props.y).toBe(50);
    expect(props.w).toBe(300);
    expect(props.h).toBe(200);
  });

  it("puts non-geometry style props into props.css, camelCased", () => {
    const edl = parseHtmlToEDL(`<h1 style="font-size: 72px; color: red;">Title</h1>`);
    const props = edl.layers[0].elements[0].props;
    expect(props.css).toEqual({ fontSize: "72px", color: "red" });
  });

  it("does not put left/top into props.css", () => {
    const edl = parseHtmlToEDL(
      `<h1 style="left: 10px; top: 20px; color: red;">Title</h1>`,
    );
    const props = edl.layers[0].elements[0].props;
    expect(props.css).not.toHaveProperty("left");
    expect(props.css).not.toHaveProperty("top");
  });

  it("resolves percentage geometry against composition dimensions", () => {
    const edl = parseHtmlToEDL(
      `<img src="a.jpg" style="left: 50%; top: 25%; width: 50%; height: 100%;" />`,
      { width: 1000, height: 800 },
    );
    const props = edl.layers[0].elements[0].props;
    expect(props.x).toBe(500);
    expect(props.y).toBe(200);
    expect(props.w).toBe(500);
    expect(props.h).toBe(800);
  });

  it("produces elements that all satisfy isValidStart and isValidDuration", () => {
    const edl = parseHtmlToEDL(
      `<img src="a.jpg" /><h1>One</h1><p>Two</p><video src="v.mp4"></video>`,
    );
    const elements = edl.layers.flatMap((l) => l.elements);
    expect(elements.length).toBeGreaterThan(0);
    for (const el of elements) {
      expect(isValidStart(el.start)).toBe(true);
      expect(isValidDuration(el.duration)).toBe(true);
    }
  });

  it("sets edl.duration to cover the last element's end", () => {
    const edl = parseHtmlToEDL(`<h1>One</h1><p>Two</p><span>Three</span>`, {
      defaultDuration: 5,
    });
    const elements = edl.layers.flatMap((l) => l.elements);
    const maxEnd = Math.max(...elements.map((e) => e.start + e.duration));
    expect(edl.duration).toBeGreaterThanOrEqual(maxEnd);
  });

  it("assigns layer index by DOM order and matches layerId to element.layerId", () => {
    const edl = parseHtmlToEDL(`<img src="a.jpg" /><h1>Title</h1>`);
    edl.layers.forEach((layer, i) => {
      expect(layer.index).toBe(i);
      for (const el of layer.elements) {
        expect(el.layerId).toBe(layer.id);
      }
    });
  });

  it("staggers text elements by DOM order but starts non-text elements at 0", () => {
    const edl = parseHtmlToEDL(`<img src="a.jpg" /><h1>First</h1><p>Second</p>`, {
      defaultDuration: 5,
    });
    const elements = edl.layers.flatMap((l) => l.elements);
    const image = elements.find((e) => e.type === "image")!;
    const texts = elements.filter((e) => e.type === "text");
    expect(image.start).toBe(0);
    expect(texts[0].start).toBe(0);
    expect(texts[1].start).toBe(5);
  });

  it("throws on empty HTML", () => {
    expect(() => parseHtmlToEDL("")).toThrow();
  });

  it("throws on HTML with no importable elements", () => {
    expect(() => parseHtmlToEDL("<html><head><title>x</title></head><body></body></html>")).toThrow();
  });
});
