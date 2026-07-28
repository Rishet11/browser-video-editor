// AI timing suggestions: build a compact prompt describing the composition,
// call the model, parse/validate its response. The provider call is isolated
// in `requestSuggestions` so swapping providers is a drop-in replacement.
import type { EDL, BaseElement } from "./edl";
import { isValidStart, isValidDuration } from "./validate";
import { callGroq, stripFence, toFiniteNumber, round2 } from "./ai/groq";

export interface TimingSuggestion {
  elementId: string;
  suggestedStart: number;
  suggestedDuration: number;
  reason: string;
}

export interface OverlapFact {
  layerId: string;
  layerName: string;
  aId: string;
  bId: string;
  overlapStart: number;
  overlapEnd: number;
}

export interface OvershootFact {
  elementId: string;
  end: number;
  overshoot: number;
}

export interface DeadAirFact {
  start: number;
  duration: number;
}

export interface TimingFacts {
  overlaps: OverlapFact[];
  overshoots: OvershootFact[];
  deadAir: DeadAirFact[];
}

// Deterministic timing analysis, no model: end times, same-layer overlaps,
// composition overshoots and dead-air gaps with plain arithmetic, so the
// model never has to derive these itself.
//
// Dead air merges intervals across ALL layers — anything visible on any
// layer counts as covered.
export function analyseTiming(edl: EDL): TimingFacts {
  const overlaps: OverlapFact[] = [];
  const overshoots: OvershootFact[] = [];

  const allElements: { start: number; end: number }[] = [];

  for (const layer of edl.layers) {
    for (const el of layer.elements) {
      const end = el.start + el.duration;
      allElements.push({ start: el.start, end });

      if (end > edl.duration) {
        overshoots.push({ elementId: el.id, end, overshoot: round2(end - edl.duration) });
      }
    }

    // Same-layer overlaps: compare every pair on this layer.
    const els = layer.elements;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i];
        const b = els[j];
        const aEnd = a.start + a.duration;
        const bEnd = b.start + b.duration;
        const overlapStart = Math.max(a.start, b.start);
        const overlapEnd = Math.min(aEnd, bEnd);
        if (overlapStart < overlapEnd) {
          overlaps.push({
            layerId: layer.id,
            layerName: layer.name,
            aId: a.id,
            bId: b.id,
            overlapStart: round2(overlapStart),
            overlapEnd: round2(overlapEnd),
          });
        }
      }
    }
  }

  // Dead air: merge intervals across every layer, then find the gaps between
  // merged intervals (and at start/end) within [0, duration].
  const sorted = allElements.slice().sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const { start, end } of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      merged.push({ start, end });
    }
  }

  const deadAir: DeadAirFact[] = [];
  let cursor = 0;
  for (const { start, end } of merged) {
    if (start > cursor) {
      deadAir.push({ start: round2(cursor), duration: round2(start - cursor) });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < edl.duration) {
    deadAir.push({ start: round2(cursor), duration: round2(edl.duration - cursor) });
  }

  return { overlaps, overshoots, deadAir };
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
  const layersByIndex = [...edl.layers].sort((a, b) => a.index - b.index);
  const layersBlock = layersByIndex
    .map((layer) => {
      const elements = layer.elements.map((el) => ({
        id: el.id,
        type: el.type,
        start: el.start,
        duration: el.duration,
        hint: contentHint(el),
      }));
      return `Layer "${layer.name}" (id: ${layer.id}, stacking index ${layer.index}): ${JSON.stringify(elements, null, 0)}`;
    })
    .join("\n");

  const facts = analyseTiming(edl);

  const overshootLines = facts.overshoots.length
    ? facts.overshoots
        .map((o) => `- "${o.elementId}" ends at ${o.end}s, which is ${o.overshoot}s past the composition end (${edl.duration}s).`)
        .join("\n")
    : "- none";

  const overlapLines = facts.overlaps.length
    ? facts.overlaps
        .map((o) => `- On layer "${o.layerName}" (${o.layerId}): "${o.aId}" and "${o.bId}" overlap from ${o.overlapStart}s to ${o.overlapEnd}s.`)
        .join("\n")
    : "- none";

  const deadAirLines = facts.deadAir.length
    ? facts.deadAir
        .map((d) => `- ${d.duration}s of dead air from ${d.start}s to ${round2(d.start + d.duration)}s (nothing visible on any layer).`)
        .join("\n")
    : "- none";

  const hasDefects = facts.overshoots.length > 0 || facts.overlaps.length > 0 || facts.deadAir.length > 0;

  const noDefectsNote = hasDefects
    ? ""
    : `\nNo timing defects were found by analysis: no overshoots, no same-layer overlaps, no dead air. The correct answer is an empty suggestions list. Do not invent a problem to justify a suggestion.\n`;

  return `You are a video editing assistant. The composition is ${edl.duration} seconds long, made of the following layers (each element has id, type, current start/duration in seconds, a short content hint), listed bottom-to-top stacking order:

${layersBlock}

Layer semantics: elements on DIFFERENT layers are expected to overlap in time, that is normal compositing (e.g. an overlay on top of a background video) and must NOT be reported as a problem. Only overlaps BETWEEN elements on the SAME layer are potential timing defects. Layer stacking index determines paint order: a higher-index layer draws on top of a lower one.

The following timing facts were computed deterministically (end times, same-layer overlaps, composition overshoots, dead air). Treat them as ground truth. Do NOT compute or assert your own timing arithmetic (do not derive end times, overlaps, overshoot amounts, or gap durations yourself); only use the numbers given below.

Elements ending past the composition end:
${overshootLines}

Same-layer overlaps:
${overlapLines}

Dead air (no element on any layer visible):
${deadAirLines}
${noDefectsNote}
Using ONLY the facts above, propose improved start/duration values (in seconds) for elements whose timing has a real, factual issue. Your job is to PROPOSE new values and EXPLAIN each one by citing the specific fact it addresses; do not restate or invent arithmetic beyond what is given above. Only include elements you have a specific, concrete suggestion for; omit elements that are already fine. If no facts above indicate a problem, return an empty suggestions list.

Respond with ONLY a JSON object of this exact shape, no other text:
{"suggestions":[{"elementId":"<id>","suggestedStart":<number>,"suggestedDuration":<number>,"reason":"<short specific clause>"}]}

Each "reason" must cite the specific fact it addresses (e.g. "fills the dead air from 13s to 15s" or "ends 1s past the composition end at 13s"). Do not use generic filler like "improves pacing" or "better flow", and do not state a timing claim that isn't one of the facts given above.`;
}

/** Thin wrapper over the shared Groq call, kept for existing callers/tests. */
export async function requestSuggestions(prompt: string): Promise<{ content: string; model: string }> {
  return callGroq(prompt);
}

/** Parses and validates a model response, discarding bad entries. */
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
