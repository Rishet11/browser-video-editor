import { create } from "zustand";
import {
  type EDL,
  type BaseElement,
  moveElement as moveEl,
  trimElement as trimEl,
  splitElement as splitEl,
} from "./edl";

/**
 * FROZEN CONTRACT. State field names, action names and argument order are
 * depended on by the canvas, the timeline, the properties panel and the AI
 * suggestions panel. Do not rename or reorder.
 *
 * Undo/redo is a snapshot stack over the immutable EDL: every mutating action
 * pushes the current `present` onto `past` before applying, and clears
 * `future`. This is cheap precisely because the EDL transforms are pure.
 *
 * Rejected edits (the pure transform returned the same reference) are NOT
 * pushed onto `past` — an invalid drag must not consume an undo step. Each
 * mutating action returns `true` if applied, `false` if rejected, so callers
 * can surface an error without re-deriving the validation rules.
 */
export interface EditorState {
  present: EDL | null;
  past: EDL[];
  future: EDL[];
  selectedElementId: string | null;
  playhead: number;
  playing: boolean;
  speed: number;
  /** Autosave indicator: null before the first save attempt. */
  saveStatus: "saving" | "saved" | "error" | null;
  /**
   * Set while a pointer drag is in flight. A drag applies many transforms (one
   * per pointermove) but must be ONE undo step, so history pushes are suspended
   * between beginDrag and endDrag.
   */
  dragging: boolean;

  load: (edl: EDL) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  selectElement: (id: string | null) => void;
  setSaveStatus: (status: EditorState["saveStatus"]) => void;

  moveElement: (elementId: string, newStart: number) => boolean;
  trimElement: (elementId: string, edge: "start" | "end", delta: number) => boolean;
  splitElement: (elementId: string, atTime: number) => boolean;
  patchElement: (
    elementId: string,
    patch: Partial<Pick<BaseElement, "start" | "duration" | "trimIn" | "props">>,
  ) => boolean;

  /**
   * Coalesce a pointer drag into a single undo step. `beginDrag` remembers the
   * pre-drag EDL without pushing it; `endDrag` pushes that baseline only if the
   * drag actually changed something, so a drag that was rejected end-to-end
   * leaves no empty entry in the history.
   */
  beginDrag: () => void;
  endDrag: () => void;

  undo: () => void;
  redo: () => void;
}

/** Apply a pure EDL transform, pushing an undo snapshot only if it was accepted. */
function applyTransform(
  state: EditorState,
  transform: (edl: EDL) => EDL,
): Partial<EditorState> | null {
  const { present } = state;
  if (!present) return null;
  const next = transform(present);
  if (next === present) return null; // rejected by the transform
  // Mid-drag: apply the edit but suspend the history push. endDrag() records
  // the whole drag as one entry.
  if (state.dragging) return { present: next };
  return { present: next, past: [...state.past, present], future: [] };
}

/** Pre-drag EDL, held outside the store so it never triggers a re-render. */
let dragBaseline: EDL | null = null;

export const useEditorStore = create<EditorState>((set, get) => ({
  present: null,
  past: [],
  future: [],
  selectedElementId: null,
  playhead: 0,
  playing: false,
  speed: 1,
  saveStatus: null,
  dragging: false,

  load: (edl) => set({ present: edl, past: [], future: [], playhead: 0 }),
  setPlayhead: (t) => set({ playhead: t }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  selectElement: (id) => set({ selectedElementId: id }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),

  moveElement: (elementId, newStart) => {
    const patch = applyTransform(get(), (edl) => moveEl(edl, elementId, newStart));
    if (!patch) return false;
    set(patch);
    return true;
  },

  trimElement: (elementId, edge, delta) => {
    const patch = applyTransform(get(), (edl) => trimEl(edl, elementId, edge, delta));
    if (!patch) return false;
    set(patch);
    return true;
  },

  splitElement: (elementId, atTime) => {
    const patch = applyTransform(get(), (edl) => splitEl(edl, elementId, atTime));
    if (!patch) return false;
    set(patch);
    return true;
  },

  patchElement: (elementId, patch) => {
    const result = applyTransform(get(), (edl) => {
      const layerIdx = edl.layers.findIndex((l) =>
        l.elements.some((e) => e.id === elementId),
      );
      if (layerIdx === -1) return edl;
      const layer = edl.layers[layerIdx];
      const elements = layer.elements.map((e) =>
        e.id === elementId ? { ...e, ...patch } : e,
      );
      const layers = edl.layers.slice();
      layers[layerIdx] = { ...layer, elements };
      return { ...edl, layers };
    });
    if (!result) return false;
    set(result);
    return true;
  },

  beginDrag: () => {
    dragBaseline = get().present;
    set({ dragging: true });
  },

  endDrag: () => {
    const { present, past } = get();
    const baseline = dragBaseline;
    dragBaseline = null;
    // Only record history if the drag changed something. A drag that was
    // rejected throughout leaves the history untouched.
    if (baseline && present && baseline !== present) {
      set({ dragging: false, past: [...past, baseline], future: [] });
    } else {
      set({ dragging: false });
    }
  },

  undo: () => {
    const { past, present } = get();
    if (!present || past.length === 0) return;
    set({
      present: past[past.length - 1],
      past: past.slice(0, -1),
      future: [present, ...get().future],
    });
  },

  redo: () => {
    const { future, present } = get();
    if (!present || future.length === 0) return;
    set({
      present: future[0],
      future: future.slice(1),
      past: [...get().past, present],
    });
  },
}));
