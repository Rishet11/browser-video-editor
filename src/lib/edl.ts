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
 * The one function preview, canvas and export all call.
 *
 * Contract:
 * 1. Flatten elements across layers, keep those with `start <= t < start + duration`.
 * 2. Sort by layer `index` ascending, so the top layer paints last.
 * 3. Compute `localTime` per the rule on `VisibleElement`.
 * 4. Pure. No DOM access, no side effects, no clock reads.
 */
export function resolveAt(edl: EDL, t: number): VisibleElement[] {
  throw new Error("not implemented");
}

/** Set an element's timeline start. Rejects (returns edl unchanged) if start < 0. */
export function moveElement(edl: EDL, elementId: string, newStart: number): EDL {
  throw new Error("not implemented");
}

/**
 * Trim one edge of an element.
 *
 * "start" edge: shifts `start` AND `trimIn` by the same delta, so the source
 * offset tracks the timeline edge. "end" edge: changes `duration` only.
 * Rejects if the result would put `duration` below MIN_DURATION or `start`
 * below 0.
 */
export function trimElement(
  edl: EDL,
  elementId: string,
  edge: "start" | "end",
  delta: number,
): EDL {
  throw new Error("not implemented");
}

/**
 * Split an element at absolute timeline time `atTime`, replacing it with two.
 * The second half inherits `trimIn + (atTime - start)`. Rejects if `atTime`
 * falls outside the element, or if either half would be under MIN_DURATION.
 */
export function splitElement(edl: EDL, elementId: string, atTime: number): EDL {
  throw new Error("not implemented");
}
