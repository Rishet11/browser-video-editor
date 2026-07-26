/**
 * AI timing suggestions: build a compact prompt describing the composition,
 * call the model, and parse/validate its response into TimingSuggestion[].
 *
 * Provider call is isolated in `requestSuggestions` so swapping providers
 * (Anthropic, OpenAI, etc.) is a drop-in replacement for that one function.
 */
import type { EDL, BaseElement } from "./edl";
import { isValidStart, isValidDuration } from "./validate";

export interface TimingSuggestion {
  elementId: string;
  suggestedStart: number;
  suggestedDuration: number;
  reason: string;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

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

/** One HTTP call to Groq's OpenAI-compatible chat completions endpoint.
 * Swapping providers (Anthropic /v1/messages, OpenAI /v1/chat/completions)
 * is a drop-in replacement for the body of this function. */
export async function requestSuggestions(prompt: string): Promise<{ content: string; model: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is unset");
  }

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return { content, model: json.model ?? GROQ_MODEL };
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

    const reason = typeof e.reason === "string" ? e.reason : "";

    seen.add(elementId);
    result.push({
      elementId,
      suggestedStart: round2(start),
      suggestedDuration: round2(duration),
      reason,
    });
  }

  return result;
}
