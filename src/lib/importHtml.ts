// HTML-composition importer: the second reading of "load an HTML composition"
// (parse a supplied file, vs loading a stored one — GET /api/editor/{id} covers
// that). Deliberately narrow: hand-rolled regex, no DOM lib, trusted-ish input.
//
// Rules:
// - <script>/<style> stripped before scanning.
// - Recognised tags: <img>, <video> (src attr or nested <source>), and
//   text-bearing <div> <p> <h1>-<h6> <span>. Everything else ignored.
// - A text tag becomes an element only on non-empty DIRECT text; a pure
//   container is recursed into instead.
// - Text is entity-decoded and whitespace-collapsed.
// - left/top/width/height from inline style -> x/y/w/h (px, bare numbers, %
//   of composition size; missing -> sane defaults). Other declarations go
//   into props.css camelCased; the four geometry props are excluded so css
//   can't override positioning.
//
// Timing: HTML carries none, so it's invented. Each element gets its own
// layer in DOM order (DOM order -> z-order, as HTML stacks). Media starts at
// 0 for defaultDuration; the i-th text element starts at i * defaultDuration
// so a demo isn't one pile of captions. edl.duration = max element end.
// trimIn is always 0.
//
// Pure: counter-generated ids, no Date.now/Math.random — deterministic and
// testable.

import type { EDL, Layer, BaseElement, ElementType } from "./edl";
import { isValidStart, isValidDuration } from "./validate";

export interface ImportOptions {
  name?: string;
  width?: number;
  height?: number;
  defaultDuration?: number;
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
      return match;
    }
    const key = entity.toLowerCase();
    return ENTITY_MAP[key] ?? match;
  });
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripTags(html: string): string {
  return decodeEntities(collapseWhitespace(html.replace(/<[^>]*>/g, " ")));
}

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function parseAttrs(tagSource: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z-][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(tagSource)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3];
    attrs[name] = value;
  }
  return attrs;
}

function camelCase(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

function resolveDimension(raw: string | undefined, axisSize: number, fallback: number): number {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  const pctMatch = /^([\d.]+)%$/.exec(trimmed);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    return Number.isFinite(pct) ? (pct / 100) * axisSize : fallback;
  }
  const pxMatch = /^([\d.]+)(px)?$/.exec(trimmed);
  if (pxMatch) {
    const n = parseFloat(pxMatch[1]);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseStyle(
  styleAttr: string | undefined,
  compWidth: number,
  compHeight: number,
  defaultGeometry: Geometry,
): { geometry: Geometry; css: Record<string, string> } {
  const decls: Record<string, string> = {};
  if (styleAttr) {
    for (const part of styleAttr.split(";")) {
      const idx = part.indexOf(":");
      if (idx === -1) continue;
      const prop = part.slice(0, idx).trim().toLowerCase();
      const value = part.slice(idx + 1).trim();
      if (!prop || !value) continue;
      decls[prop] = value;
    }
  }

  const geometry: Geometry = {
    x: resolveDimension(decls["left"], compWidth, defaultGeometry.x),
    y: resolveDimension(decls["top"], compHeight, defaultGeometry.y),
    w: resolveDimension(decls["width"], compWidth, defaultGeometry.w),
    h: resolveDimension(decls["height"], compHeight, defaultGeometry.h),
  };

  const css: Record<string, string> = {};
  for (const [prop, value] of Object.entries(decls)) {
    if (prop === "left" || prop === "top" || prop === "width" || prop === "height") continue;
    css[camelCase(prop)] = value;
  }

  return { geometry, css };
}

interface ParsedElement {
  type: ElementType;
  props: Record<string, unknown>;
}

const TEXT_TAGS = ["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "span"];

export function parseHtmlToEDL(html: string, options?: ImportOptions): EDL {
  const width = options?.width ?? 1920;
  const height = options?.height ?? 1080;
  const defaultDuration = options?.defaultDuration ?? 5;
  const name = options?.name ?? "Imported Composition";

  const cleaned = stripScriptsAndStyles(html);

  const defaultGeometry: Geometry = { x: 0, y: 0, w: width / 2, h: height / 4 };

  // Match self-contained tags in DOM order: img (void), video (with body for
  // nested <source>), and text-bearing tags (with body for direct text).
  const tagPattern = new RegExp(
    `<img\\b([^>]*)\\/?>` +
      `|<video\\b([^>]*)>([\\s\\S]*?)<\\/video>` +
      `|<video\\b([^>]*)\\/?>` +
      `|<(${TEXT_TAGS.join("|")})\\b([^>]*)>([\\s\\S]*?)<\\/\\5>`,
    "gi",
  );

  // Recursion: a container tag with no direct text of its own emits nothing,
  // but its body is scanned for nested elements. A tag WITH direct text is
  // emitted and its body is not re-scanned (avoids double-counting).
  // Depth is capped: nesting depth is attacker-controlled (this parser is
  // reachable from POST /api/editor/import), and unbounded nested divs would
  // overflow the stack. Real compositions nest nowhere near 32.
  const MAX_DEPTH = 32;

  function scan(source: string, depth = 0): ParsedElement[] {
    if (depth >= MAX_DEPTH) return [];
    const found: ParsedElement[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(tagPattern.source, tagPattern.flags);
    while ((match = re.exec(source)) !== null) {
      if (match[1] !== undefined) {
        // <img>
        const attrs = parseAttrs(match[1]);
        const { geometry, css } = parseStyle(attrs["style"], width, height, defaultGeometry);
        const props: Record<string, unknown> = {
          src: attrs["src"] ?? "",
          x: geometry.x,
          y: geometry.y,
          w: geometry.w,
          h: geometry.h,
        };
        if (Object.keys(css).length > 0) props.css = css;
        found.push({ type: "image", props });
        continue;
      }

      if (match[2] !== undefined || match[4] !== undefined) {
        // <video>...</video> (match[2]/[3]) or self-closing <video/> (match[4])
        const attrsSrc = match[2] !== undefined ? match[2] : match[4];
        const body = match[3] ?? "";
        const attrs = parseAttrs(attrsSrc);
        let src = attrs["src"];
        if (!src) {
          const sourceMatch = /<source\b([^>]*)>/i.exec(body);
          if (sourceMatch) {
            const sourceAttrs = parseAttrs(sourceMatch[1]);
            src = sourceAttrs["src"];
          }
        }
        const { geometry, css } = parseStyle(attrs["style"], width, height, defaultGeometry);
        const props: Record<string, unknown> = {
          src: src ?? "",
          x: geometry.x,
          y: geometry.y,
          w: geometry.w,
          h: geometry.h,
        };
        if (Object.keys(css).length > 0) props.css = css;
        found.push({ type: "video", props });
        continue;
      }

      if (match[5] !== undefined) {
        // text-bearing tag
        const attrs = parseAttrs(match[6]);
        const body = match[7] ?? "";
        // Direct text = body with nested tags (and their contents) removed.
        // Non-empty after decoding => text element; empty => pure container,
        // so recurse into the body instead.
        const withoutNested = body.replace(/<[^>]+>[\s\S]*?<\/[^>]+>|<[^>]+\/?>/g, "");
        const directText = collapseWhitespace(decodeEntities(withoutNested));
        if (!directText) {
          found.push(...scan(body, depth + 1));
          continue;
        }

        const { geometry, css } = parseStyle(attrs["style"], width, height, defaultGeometry);
        const props: Record<string, unknown> = {
          text: directText,
          x: geometry.x,
          y: geometry.y,
          w: geometry.w,
          h: geometry.h,
        };
        if (Object.keys(css).length > 0) props.css = css;
        found.push({ type: "text", props });
      }
    }
    return found;
  }

  const parsed = scan(cleaned);

  if (parsed.length === 0) {
    throw new Error("parseHtmlToEDL: no importable elements found in HTML");
  }

  let textIndex = 0;
  const layers: Layer[] = [];
  let maxEnd = 0;

  parsed.forEach((el, i) => {
    const layerId = `import-l${i}`;
    const elementId = `import-e${i}`;
    const start = el.type === "text" ? textIndex * defaultDuration : 0;
    if (el.type === "text") textIndex += 1;
    const duration = defaultDuration;

    if (!isValidStart(start)) {
      throw new Error(`parseHtmlToEDL: computed invalid start ${start} for element ${elementId}`);
    }
    if (!isValidDuration(duration)) {
      throw new Error(
        `parseHtmlToEDL: computed invalid duration ${duration} for element ${elementId}`,
      );
    }

    maxEnd = Math.max(maxEnd, start + duration);

    const element: BaseElement = {
      id: elementId,
      layerId,
      type: el.type,
      start,
      duration,
      trimIn: 0,
      props: el.props,
    };

    layers.push({
      id: layerId,
      name: `Layer ${i + 1}`,
      index: i,
      elements: [element],
    });
  });

  const edl: EDL = {
    id: "imported",
    name,
    duration: maxEnd,
    width,
    height,
    layers,
  };

  return edl;
}
