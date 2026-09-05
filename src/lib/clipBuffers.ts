import type { Note } from "@/lib/Domain";

import { type NoteRow, rowsOf, sameNotes } from "@/lib/noteEdits";

export type SlotName = "a" | "b";

/**
 * Three named note lists for one loaded clip. `baseline` is read-only and
 * captured on load; `a` and `b` are editable and exactly one is `active`. The
 * active slot is the working list: the table shows it, edits change it, and
 * autowrite sends it. `nextId` is the row-id counter shared by every buffer so
 * a row copied between slots keeps its id and no two rows ever share one.
 */
export interface ClipBuffers {
  readonly baseline: readonly NoteRow[];
  readonly a: readonly NoteRow[];
  readonly b: readonly NoteRow[];
  readonly active: SlotName;
  readonly nextId: number;
}

export type BuffersAction =
  | { readonly type: "load"; readonly notes: readonly Note[] }
  | { readonly type: "edit"; readonly rows: readonly NoteRow[] }
  | { readonly type: "mint"; readonly count: number }
  | { readonly type: "switch" }
  | { readonly type: "copyToOther" }
  | { readonly type: "revert" }
  | { readonly type: "setBaseline" };

export const EMPTY_BUFFERS: ClipBuffers = {
  baseline: [],
  a: [],
  b: [],
  active: "a",
  nextId: 1,
};

export const otherSlotOf = (slot: SlotName): SlotName =>
  slot === "a" ? "b" : "a";

export const buffersReducer = (
  state: ClipBuffers,
  action: BuffersAction,
): ClipBuffers => {
  switch (action.type) {
    case "load": {
      const { rows, nextId } = rowsOf(action.notes, 1);
      return { baseline: rows, a: rows, b: rows, active: "a", nextId };
    }
    case "edit": {
      return { ...state, [state.active]: action.rows };
    }
    case "mint": {
      return { ...state, nextId: state.nextId + action.count };
    }
    case "switch": {
      return { ...state, active: otherSlotOf(state.active) };
    }
    case "copyToOther": {
      return { ...state, [otherSlotOf(state.active)]: state[state.active] };
    }
    case "revert": {
      return { ...state, [state.active]: state.baseline };
    }
    case "setBaseline": {
      return { ...state, baseline: state[state.active] };
    }
  }
};

export const activeRowsOf = (state: ClipBuffers): readonly NoteRow[] =>
  state[state.active];

export const slotSummaryOf = (state: ClipBuffers) => {
  const other = otherSlotOf(state.active);
  return {
    active: state.active,
    activeDiffersFromBaseline: !sameNotes(state[state.active], state.baseline),
    otherDiffersFromBaseline: !sameNotes(state[other], state.baseline),
    slotsDiffer: !sameNotes(state.a, state.b),
    anyDiffersFromBaseline:
      !sameNotes(state.a, state.baseline) ||
      !sameNotes(state.b, state.baseline),
  };
};
