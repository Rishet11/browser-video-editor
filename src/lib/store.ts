import { create } from "zustand";
import { isValidDuration, isValidStart } from "./validate";
import {
  type EDL,
  type BaseElement,
  moveElement as moveEl,
  trimElement as trimEl,
  splitElement as splitEl,
} from "./edl";

// FROZEN CONTRACT: field and action names are depended on by the canvas,
// timeline, properties panel and suggestions panel. Don't rename or reorder.
//
// Undo/redo is a snapshot stack over the immutable EDL — cheap because the
// transforms are pure. Rejected edits (transform returned the same reference)
// are NOT pushed onto `past`: an invalid drag must not eat an undo step. Each
// action returns true/false so the UI can surface the rejection.
export interface EditorState {
  present: EDL | null;
  past: EDL[];
  future: EDL[];
  selectedElementId: string | null;
  playhead: number;
  playing: boolean;
  speed: number;
  /** Autosave indicator: null before the first save attempt. */
  saveStatus: "saving" | "saved" | "error" | "conflict" | null;
  // Last-Modified from the server (initial GET or a successful PUT), sent back
  // as If-Unmodified-Since so autosave can detect a concurrent edit. In the
  // store because both the loader and useAutosave need it.
  lastModified: string | null;
  // Set while a pointer drag is in flight. A drag applies many transforms (one
  // per pointermove) but must be ONE undo step, so history pushes are suspended
  // between beginDrag and endDrag.
  dragging: boolean;

  load: (edl: EDL) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  selectElement: (id: string | null) => void;
  setSaveStatus: (status: EditorState["saveStatus"]) => void;
  setLastModified: (value: string | null) => void;

  moveElement: (elementId: string, newStart: number) => boolean;
  trimElement: (elementId: string, edge: "start" | "end", delta: number) => boolean;
  splitElement: (elementId: string, atTime: number) => boolean;
  patchElement: (
    elementId: string,
    patch: Partial<Pick<BaseElement, "start" | "duration" | "trimIn" | "props">>,
  ) => boolean;

  // beginDrag remembers the pre-drag EDL without pushing it; endDrag pushes
  // that baseline only if the drag actually changed something, so a fully
  // rejected drag leaves no empty history entry.
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
  // Mid-drag: apply the edit but suspend the history push; endDrag records
  // the whole drag as one entry.
  if (state.dragging) return { present: next };
  return { present: next, past: [...state.past, present], future: [] };
}

/** Pre-drag EDL, kept outside the store so it never triggers a re-render. */
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
  lastModified: null,
  dragging: false,

  load: (edl) => {
    // Drop any drag baseline: it belongs to the composition being replaced,
    // and pushing it here would let undo restore another composition's data.
    dragBaseline = null;
    set({ present: edl, past: [], future: [], playhead: 0, dragging: false });
  },
  setPlayhead: (t) => set({ playhead: t }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  selectElement: (id) => set({ selectedElementId: id }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setLastModified: (lastModified) => set({ lastModified }),

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
    // Validate here, not just in the route. Every other mutator inherits its
    // rules from the pure transforms, but this one writes fields directly —
    // without the check the properties panel could persist a negative trimIn
    // or sub-minimum duration that the transforms consider illegal.
    if (patch.start !== undefined && !isValidStart(patch.start)) return false;
    if (patch.duration !== undefined && !isValidDuration(patch.duration)) return false;
    if (
      patch.trimIn !== undefined &&
      (!Number.isFinite(patch.trimIn) || patch.trimIn < 0)
    ) {
      return false;
    }

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
    // Record history only if the drag changed something; a fully rejected
    // drag leaves it untouched.
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
