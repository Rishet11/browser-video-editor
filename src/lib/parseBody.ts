import { type EDL, type BaseElement } from "./edl";

/**
 * Request-body parsing for the route handlers.
 *
 * `await req.json() as EDL` is a lie the type system happily accepts: the cast
 * asserts a shape nobody checked. A body of `{}` then fails deep inside the
 * handler on `body.layers` being undefined, which surfaces to the caller as a
 * 500. A malformed request is the client's mistake and should read as 400, so
 * the shape is checked once, here, before any handler logic runs.
 *
 * These are hand-written guards rather than a schema library because the shapes
 * are small and fixed, and adding a dependency for four of them is not worth it.
 * If the API grew, this is the file that would become a zod schema.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Reads and JSON-parses a body, turning a syntax error into a message. */
export async function readJson(req: Request): Promise<ParseResult<unknown>> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false, error: "Request body is not valid JSON" };
  }
}

export function parseEDL(input: unknown): ParseResult<EDL> {
  if (!isRecord(input)) return { ok: false, error: "Body must be a JSON object" };
  if (typeof input.id !== "string") return { ok: false, error: "Missing 'id'" };
  if (typeof input.name !== "string") return { ok: false, error: "Missing 'name'" };
  if (!isFiniteNumber(input.duration)) return { ok: false, error: "Missing 'duration'" };
  if (!isFiniteNumber(input.width)) return { ok: false, error: "Missing 'width'" };
  if (!isFiniteNumber(input.height)) return { ok: false, error: "Missing 'height'" };
  if (!Array.isArray(input.layers)) return { ok: false, error: "'layers' must be an array" };

  for (const [i, layer] of input.layers.entries()) {
    if (!isRecord(layer)) return { ok: false, error: `layers[${i}] must be an object` };
    if (typeof layer.id !== "string") return { ok: false, error: `layers[${i}].id must be a string` };
    if (typeof layer.name !== "string") return { ok: false, error: `layers[${i}].name must be a string` };
    if (!isFiniteNumber(layer.index)) return { ok: false, error: `layers[${i}].index must be a number` };
    if (!Array.isArray(layer.elements)) {
      return { ok: false, error: `layers[${i}].elements must be an array` };
    }
    for (const [j, el] of layer.elements.entries()) {
      const where = `layers[${i}].elements[${j}]`;
      if (!isRecord(el)) return { ok: false, error: `${where} must be an object` };
      if (typeof el.id !== "string") return { ok: false, error: `${where}.id must be a string` };
      if (el.type !== "text" && el.type !== "image" && el.type !== "video") {
        return { ok: false, error: `${where}.type must be text, image or video` };
      }
      if (!isFiniteNumber(el.start)) return { ok: false, error: `${where}.start must be a number` };
      if (!isFiniteNumber(el.duration)) {
        return { ok: false, error: `${where}.duration must be a number` };
      }
      if (!isFiniteNumber(el.trimIn)) {
        return { ok: false, error: `${where}.trimIn must be a number` };
      }
      if (!isRecord(el.props)) return { ok: false, error: `${where}.props must be an object` };
    }
  }

  return { ok: true, value: input as unknown as EDL };
}

export type ElementPatch = Partial<
  Pick<BaseElement, "start" | "duration" | "trimIn" | "props">
>;

export function parseElementPatch(input: unknown): ParseResult<ElementPatch> {
  if (!isRecord(input)) return { ok: false, error: "Body must be a JSON object" };

  const patch: ElementPatch = {};
  if (input.start !== undefined) {
    if (!isFiniteNumber(input.start)) return { ok: false, error: "'start' must be a number" };
    patch.start = input.start;
  }
  if (input.duration !== undefined) {
    if (!isFiniteNumber(input.duration)) {
      return { ok: false, error: "'duration' must be a number" };
    }
    patch.duration = input.duration;
  }
  if (input.trimIn !== undefined) {
    if (!isFiniteNumber(input.trimIn)) return { ok: false, error: "'trimIn' must be a number" };
    patch.trimIn = input.trimIn;
  }
  if (input.props !== undefined) {
    if (!isRecord(input.props)) return { ok: false, error: "'props' must be an object" };
    patch.props = input.props;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No updatable fields provided" };
  }
  return { ok: true, value: patch };
}

export function parseSplitBody(
  input: unknown,
): ParseResult<{ elementId: string; atTime: number }> {
  if (!isRecord(input)) return { ok: false, error: "Body must be a JSON object" };
  if (typeof input.elementId !== "string") {
    return { ok: false, error: "'elementId' must be a string" };
  }
  if (!isFiniteNumber(input.atTime)) return { ok: false, error: "'atTime' must be a number" };
  return { ok: true, value: { elementId: input.elementId, atTime: input.atTime } };
}
