// EDL — Edit Decision List. The composition as serialisable JSON.
// Canvas, timeline, preview and the exported HTML all read it through
// resolveAt, so they can't drift apart.
//
// FROZEN CONTRACT: the canvas, timeline, REST layer and export mirror depend
// on these names and argument orders. Don't rename; type-specific additions
// go in `props`, which stays open on purpose.

export type ElementType = "text" | "image" | "video";

export interface BaseElement {
  id: string;
  layerId: string;
  type: ElementType;
  /** Timeline position in seconds, >= 0. */
  start: number;
  /** Seconds, >= 0.5. */
  duration: number;
  // Source-media offset in seconds (video only). Separate from `start` on
  // purpose: a left-edge trim moves where playback begins *inside the file*,
  // not just where the clip sits. Collapse the two and trimmed clips jump.
  trimIn: number;
  /** Type-specific: text, src, x, y, w, h, css. */
  props: Record<string, unknown>;
}

export interface Layer {
  id: string;
  name: string;
  /** z-order and timeline track position, 1:1. Higher paints on top. */
  index: number;
  elements: BaseElement[];
}

export interface EDL {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  layers: Layer[];
}

export interface VisibleElement extends BaseElement {
  /** What the renderer plays from. text/image: `t - start`. video: `trimIn + (t - start)`. */
  localTime: number;
}

/** Minimum element duration in seconds. Enforced client-side and server-side. */
export const MIN_DURATION = 0.5;

// Round to ms. Drag/split values derive from pixel/playhead floats; stored raw
// they'd persist as 7.219075527362293. Milliseconds are finer than any frame
// boundary, so nothing real is lost.
function roundMs(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// The one function preview, canvas and export all call.
// Visible iff start <= t < start + duration. Sorted by layer index ascending
// so the top layer paints last. Pure: no DOM, no clock, no mutation.
export function resolveAt(edl: EDL, t: number): VisibleElement[] {
  const layersByIndex = [...edl.layers].sort((a, b) => a.index - b.index);
  const result: VisibleElement[] = [];
  for (const layer of layersByIndex) {
    for (const el of layer.elements) {
      if (el.start <= t && t < el.start + el.duration) {
        const localTime = el.type === "video" ? el.trimIn + (t - el.start) : t - el.start;
        result.push({ ...el, localTime });
      }
    }
  }
  return result;
}

// Rejection semantics for move/trim/split: an invalid op returns the input
// EDL UNCHANGED (same reference). Callers check `result === input`. No
// throwing, no clamping, no partial edits.

// Set timeline start. Rejects on start < 0 or running past the composition end.
export function moveElement(edl: EDL, elementId: string, newStart: number): EDL {
  if (newStart < 0) return edl;
  const layerIdx = edl.layers.findIndex((l) => l.elements.some((e) => e.id === elementId));
  if (layerIdx === -1) return edl;
  const layer = edl.layers[layerIdx];
  const el = layer.elements.find((e) => e.id === elementId)!;
  const roundedStart = roundMs(newStart);
  if (roundMs(roundedStart + el.duration) > roundMs(edl.duration)) return edl;
  const newElements = layer.elements.map((e) =>
    e.id === elementId ? { ...e, start: roundedStart } : e,
  );
  const newLayers = edl.layers.slice();
  newLayers[layerIdx] = { ...layer, elements: newElements };
  return { ...edl, layers: newLayers };
}

// Trim one edge. "start" shifts start AND trimIn together so the source
// offset tracks the timeline edge; "end" changes duration only. Rejects below
// MIN_DURATION, below 0, or (end edge) past the composition end.
export function trimElement(
  edl: EDL,
  elementId: string,
  edge: "start" | "end",
  delta: number,
): EDL {
  const layerIdx = edl.layers.findIndex((l) => l.elements.some((e) => e.id === elementId));
  if (layerIdx === -1) return edl;
  const layer = edl.layers[layerIdx];
  const el = layer.elements.find((e) => e.id === elementId)!;

  let updated: BaseElement;
  if (edge === "start") {
    const newStart = roundMs(el.start + delta);
    const newTrimIn = roundMs(el.trimIn + delta);
    const newDuration = roundMs(el.duration - delta);
    if (newStart < 0 || newDuration < MIN_DURATION || newTrimIn < 0) return edl;
    updated = { ...el, start: newStart, trimIn: newTrimIn, duration: newDuration };
  } else {
    const newDuration = roundMs(el.duration + delta);
    if (newDuration < MIN_DURATION) return edl;
    if (roundMs(el.start + newDuration) > roundMs(edl.duration)) return edl;
    updated = { ...el, duration: newDuration };
  }

  const newElements = layer.elements.map((e) => (e.id === elementId ? updated : e));
  const newLayers = edl.layers.slice();
  newLayers[layerIdx] = { ...layer, elements: newElements };
  return { ...edl, layers: newLayers };
}

// Split at absolute time atTime, replacing one element with two. The second
// half inherits trimIn + (atTime - start). Rejects outside the element or if
// either half would be under MIN_DURATION.
export function splitElement(edl: EDL, elementId: string, atTime: number): EDL {
  const layerIdx = edl.layers.findIndex((l) => l.elements.some((e) => e.id === elementId));
  if (layerIdx === -1) return edl;
  const layer = edl.layers[layerIdx];
  const el = layer.elements.find((e) => e.id === elementId)!;

  if (atTime <= el.start || atTime >= el.start + el.duration) return edl;

  const roundedAtTime = roundMs(atTime);
  const firstDuration = roundMs(roundedAtTime - el.start);
  const secondDuration = roundMs(el.start + el.duration - roundedAtTime);
  if (firstDuration < MIN_DURATION || secondDuration < MIN_DURATION) return edl;

  let counter = 1;
  let newId = `${el.id}-split-${counter}`;
  const existingIds = new Set(edl.layers.flatMap((l) => l.elements.map((e) => e.id)));
  while (existingIds.has(newId)) {
    counter += 1;
    newId = `${el.id}-split-${counter}`;
  }

  const first: BaseElement = { ...el, duration: firstDuration, props: { ...el.props } };
  const second: BaseElement = {
    ...el,
    id: newId,
    start: roundedAtTime,
    duration: secondDuration,
    trimIn: roundMs(el.trimIn + (roundedAtTime - el.start)),
    props: { ...el.props },
  };

  const newElements: BaseElement[] = [];
  for (const e of layer.elements) {
    if (e.id === elementId) {
      newElements.push(first, second);
    } else {
      newElements.push(e);
    }
  }
  const newLayers = edl.layers.slice();
  newLayers[layerIdx] = { ...layer, elements: newElements };
  return { ...edl, layers: newLayers };
}
