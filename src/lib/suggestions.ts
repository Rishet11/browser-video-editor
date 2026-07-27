/**
 * AI timing suggestions: build a compact prompt describing the composition,
 * call the model, and parse/validate its response into TimingSuggestion[].
 *
 * Provider call is isolated in `requestSuggestions` so swapping providers
 * (Anthropic, OpenAI, etc.) is a drop-in replacement for that one function.
 */
import type { EDL, BaseElement } from "./edl";
import { isValidStart, isValidDuration } from "./validate";
import { callGroq, stripFence, toFiniteNumber, round2 } from "./ai/groq";

export interface TimingSuggestion {
  elementId: string;
  suggestedStart: number;
  suggestedDuration: number;
  reason: string;
}

function contentHint(el: BaseElement): string {
  if (el.type === "text") {
    const text = typeof el.props.text === "string" ? el.props.text : "";
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  }
  const src = typeof el.props.src === "string" ? el.props.src : "";
  const filename = src.split("/").pop() ?? src;
  return filename;
}

/** Compact, provider-agnostic description of the composition to reason over. */
export function buildSuggestionPrompt(edl: EDL): string {
  const elements = edl.layers.flatMap((layer) =>
    layer.elements.map((el) => ({
      id: el.id,
      type: el.type,
      start: el.start,
      duration: el.duration,
      hint: contentHint(el),
    })),
  );

  return `You are a video editing assistant. The composition is ${edl.duration} seconds long. Here are its elements (id, type, current start/duration in seconds, a short content hint):

${JSON.stringify(elements, null, 0)}

Suggest improved timing (start and duration, in seconds) for any elements whose timing could be improved (e.g. overlaps, dead air, an element that ends after the composition, awkward pacing). Only include elements you have a specific, concrete suggestion for; omit elements that are already fine.

Respond with ONLY a JSON object of this exact shape, no other text:
{"suggestions":[{"elementId":"<id>","suggestedStart":<number>,"suggestedDuration":<number>,"reason":"<short specific clause>"}]}

Each "reason" must reference the specific element's content or timing issue (e.g. "starts before the intro title finishes" or "runs 2s past the composition end"). Do not use generic filler like "improves pacing" or "better flow".`;
}

/** Thin wrapper over the shared Groq provider call, kept for existing callers/tests. */
export async function requestSuggestions(prompt: string): Promise<{ content: string; model: string }> {
  return callGroq(prompt);
}

/** Parses and VALIDATES a model response into suggestions, discarding bad entries. */
export function parseSuggestions(raw: string, edl: EDL): TimingSuggestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return [];
  }

  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { suggestions?: unknown }).suggestions)
  ) {
    list = (parsed as { suggestions: unknown[] }).suggestions;
  } else {
    return [];
  }

  const validIds = new Set(
    edl.layers.flatMap((l) => l.elements.map((e) => e.id)),
  );

  const seen = new Set<string>();
  const result: TimingSuggestion[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const elementId = typeof e.elementId === "string" ? e.elementId : null;
    if (!elementId || !validIds.has(elementId)) continue;
    if (seen.has(elementId)) continue;

    const start = toFiniteNumber(e.suggestedStart);
    const duration = toFiniteNumber(e.suggestedDuration);
    if (start === null || duration === null) continue;
    if (!isValidStart(start) || !isValidDuration(duration)) continue;
    if (start + duration > edl.duration) continue;

    const roundedStart = round2(start);
    const roundedDuration = round2(duration);
    const currentEl = edl.layers.flatMap((l) => l.elements).find((el) => el.id === elementId)!;
    if (roundedStart === currentEl.start && roundedDuration === currentEl.duration) continue;

    const reason = typeof e.reason === "string" ? e.reason : "";

    seen.add(elementId);
    result.push({
      elementId,
      suggestedStart: roundedStart,
      suggestedDuration: roundedDuration,
      reason,
    });
  }

  return result;
}
