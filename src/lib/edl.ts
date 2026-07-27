/**
 * EDL — Edit Decision List.
 *
 * The composition is a serialisable JSON document. The editor canvas, the live
 * preview and the exported standalone HTML all read it through one pure
 * function, `resolveAt`. Because there is only one renderer contract, preview
 * and export cannot drift.
 *
 * FROZEN CONTRACT. Field names, function names and argument order in this file
 * are depended on by the canvas, the timeline, the REST layer and the export
 * mirror. Do not rename or restructure. Type-specific additions belong in
 * `props`, which is deliberately open.
 */

export type ElementType = "text" | "image" | "video";

export interface BaseElement {
  id: string;
  layerId: string;
  type: ElementType;
  /** Timeline position in seconds, >= 0. */
  start: number;
  /** Seconds, >= 0.5. */
  duration: number;
  /**
   * Source-media offset in seconds (video only, default 0).
   *
   * Separate from `start` on purpose: trimming a video clip's left edge moves
   * where playback begins *inside the source file*, it does not just move the
   * clip along the timeline. Collapsing these two fields is the bug that makes
   * a trimmed clip jump.
   */
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
  /**
   * The time the renderer needs, not just a visibility flag.
   * text/image: `t - start`. video: `trimIn + (t - start)`.
   */
  localTime: number;
}

/** Minimum element duration in seconds. Enforced client-side and server-side. */
export const MIN_DURATION = 0.5;

/**
 * Round to millisecond precision (3dp). Timeline drag/trim/split all derive
 * from pixel or playhead floats; storing them raw produces unbounded
 * mantissas (e.g. 7.219075527362293) in the composition and in Postgres.
 * Milliseconds are far finer than any frame boundary at normal frame rates,
 * so this loses nothing real.
 */
function roundMs(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * The one function preview, canvas and export all call.
 *
 * Contract:
 * 1. Flatten elements across layers, keep those with `start <= t < start + duration`.
 * 2. Sort by layer `index` ascending, so the top layer paints last.
 * 3. Compute `localTime` per the rule on `VisibleElement`.
 * 4. Pure. No DOM access, no side effects, no clock reads.
 */
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

/**
 * Rejection semantics for moveElement/trimElement/splitElement: an invalid
 * operation returns the input EDL UNCHANGED (same reference). Callers detect
 * rejection with `result === input`. No throwing, no clamping, no partial
 * application.
 */

/**
 * Set an element's timeline start. Rejects (returns edl unchanged) if start < 0
 * or if the resulting `start + duration` would exceed the composition duration.
 */
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

/**
 * Trim one edge of an element.
 *
 * "start" edge: shifts `start` AND `trimIn` by the same delta, so the source
 * offset tracks the timeline edge. "end" edge: changes `duration` only.
 * Rejects if the result would put `duration` below MIN_DURATION, `start`
 * below 0, or (for the "end" edge) `start + duration` above the composition
 * duration.
 */
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

/**
 * Split an element at absolute timeline time `atTime`, replacing it with two.
 * The second half inherits `trimIn + (atTime - start)`. Rejects if `atTime`
 * falls outside the element, or if either half would be under MIN_DURATION.
 */
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
