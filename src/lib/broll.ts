// AI B-roll suggestions: find coverage opportunities (dead air, text-only
// stretches, long unbroken shots) and propose stock-footage search terms for
// them. Keywords only — never proposes an element to insert, just search
// terms for a human to source real footage with.
//
// Non-overlapping with timing suggestions on purpose: this prompt forbids
// touching existing timing, so the two AI features can't propose conflicts.
import type { EDL, BaseElement } from "./edl";
import { isValidStart, isValidDuration } from "./validate";
import { stripFence, toFiniteNumber, round2 } from "./ai/groq";

export interface BrollSuggestion {
  afterElementId: string; // a real element id, or "__start__" = before the first element
  gapStart: number;
  gapDuration: number;
  searchTerms: string[]; // 1-5 short phrases
  shotType: string; // "establishing" | "cutaway" | "closeup" | "action"
  reason: string;
}

const SHOT_TYPES = new Set(["establishing", "cutaway", "closeup", "action"]);

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
export function buildBrollPrompt(edl: EDL): string {
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

Find COVERAGE OPPORTUNITIES: dead air where nothing is playing, a stretch covered only by text with no visual, or a long unbroken shot over roughly 6 seconds that would benefit from a cutaway. For each opportunity, suggest stock-footage search terms that would work well there.

Do NOT change any existing element's timing. You may recommend B-roll over an existing background image or video. This is normal editor compositing, not a conflict. Never suggest moving, resizing, or removing an existing element.

Respond with ONLY a JSON object of this exact shape, no other text:
{"suggestions":[{"afterElementId":"<id or \\"__start__\\">","gapStart":<number>,"gapDuration":<number>,"searchTerms":["<short phrase>"],"shotType":"establishing"|"cutaway"|"closeup"|"action","reason":"<short specific clause>"}]}

"afterElementId" is the id of the element immediately before the gap, or "__start__" if the gap is before the first element. Each "reason" must reference the specific gap (e.g. "5s of dead air before the intro title" or "8s unbroken interview shot wants a cutaway"). Do not use generic filler like "improves pacing".`;
}

/** Parses and validates a model response, discarding bad entries. */
export function parseBrollSuggestions(raw: string, edl: EDL): BrollSuggestion[] {
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

  const allElements = edl.layers.flatMap((l) => l.elements);
  const validIds = new Set(allElements.map((e) => e.id));

  const seen = new Set<string>();
  const result: BrollSuggestion[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const afterElementId = typeof e.afterElementId === "string" ? e.afterElementId : null;
    if (!afterElementId) continue;
    if (afterElementId !== "__start__" && !validIds.has(afterElementId)) continue;

    const gapStart = toFiniteNumber(e.gapStart);
    const gapDuration = toFiniteNumber(e.gapDuration);
    if (gapStart === null || gapDuration === null) continue;
    if (!isValidStart(gapStart) || !isValidDuration(gapDuration)) continue;
    if (gapStart + gapDuration > edl.duration) continue;

    const rawTerms = Array.isArray(e.searchTerms) ? e.searchTerms : [];
    const searchTerms = rawTerms
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => (t.length > 60 ? t.slice(0, 60) : t))
      .slice(0, 5);
    if (searchTerms.length === 0) continue;

    const shotTypeRaw = typeof e.shotType === "string" ? e.shotType : "";
    const shotType = SHOT_TYPES.has(shotTypeRaw) ? shotTypeRaw : "cutaway";

    const reason = typeof e.reason === "string" ? e.reason : "";

    const roundedGapStart = round2(gapStart);
    const roundedGapDuration = round2(gapDuration);

    const dedupKey = `${afterElementId}:${roundedGapStart}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    result.push({
      afterElementId,
      gapStart: roundedGapStart,
      gapDuration: roundedGapDuration,
      searchTerms,
      shotType,
      reason,
    });
  }

  return result;
}
