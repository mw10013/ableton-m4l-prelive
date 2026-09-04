import { useEffect, useRef, useState } from "react";

import { TextInput } from "@astryxdesign/core/TextInput";
import { colorVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

import { cellTextStyles } from "@/components/NoteTable";
import { useDoubleClick } from "@/components/useDoubleClick";
import { type ScrubCommitOptions, useScrub } from "@/components/useScrub";
import {
  type BeatTimeKind,
  formatBeatTime,
  isOffGrid,
  type Meter,
  meterUnits,
  MIN_DURATION,
  parseBeatTime,
  segmentRanges,
  SIXTEENTH,
} from "@/lib/beatTime";

const styles = stylex.create({
  rest: {
    display: "inline-flex",
    alignItems: "baseline",
    borderRadius: 2,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${colorVars["--color-accent"]}`,
    },
    outlineOffset: 1,
  },
  /**
   * Logic's Position column: each unit right-aligned in its own slot, separated by space rather
   * than Live's dots, so bars line up down the column once they reach two digits. Widths are the
   * widest value each slot can show: a 3-digit bar, a beat sized to content (2 digits in 12/8), one
   * sixteenth digit.
   */
  slots: {
    display: "inline-grid",
    gridTemplateColumns: "3ch auto 1ch",
    columnGap: "0.6ch",
    textAlign: "end",
  },
  segment: {
    cursor: "ns-resize",
    userSelect: "none",
  },
  offGrid: {
    marginInlineStart: "0.2ch",
  },
});

/**
 * Why an editor closed. `commit` and `cancel` return focus to the rest state; `blur` does not (the
 * pointer went elsewhere); `next` and `previous` ask the owner to open the neighbouring cell.
 */
export type EditEndReason = "commit" | "cancel" | "blur" | "next" | "previous";

/**
 * Edit-state contract shared by the note table's cells. The table owns which cell is open so Tab can
 * chain from one editor into the next; a cell only asks to open or close.
 */
export interface CellEditProps {
  /** Roving focus: the current cell is the table's single Tab stop. */
  isCurrent: boolean;
  isEditing: boolean;
  /** Text the editor opens with when a typed key started the edit. */
  editInitial?: string;
  onEditStart: (initial?: string) => void;
  onEditEnd: (reason: EditEndReason) => void;
  /** Rest-state focus, so the table's current cell follows pointer and Tab focus. */
  onFocus: () => void;
  /** `data-cell` value the table uses to find and focus this cell. */
  cellId: string;
}

export interface BarBeatSixteenthInputProps extends CellEditProps {
  label: string;
  /** Quarter-note beats. */
  value: number;
  kind: BeatTimeKind;
  numerator: number;
  denominator: number;
  min: number;
  isDisabled?: boolean;
  /** Renders in secondary text colour, as Live grays out deactivated notes. */
  isMuted?: boolean;
  /** Fires on every scrub step so a parent can mirror the gesture. */
  onChange?: (beats: number) => void;
  /**
   * Fires once per gesture (scrub release, Enter, Tab, blur with a change). Escape never commits.
   * `isMetaHeld` is true when Cmd/Ctrl was held at release or with Enter.
   */
  onCommit: (beats: number, options: ScrubCommitOptions) => void;
  /** See `useScrub`'s `pointerLock`. */
  pointerLock?: boolean;
}

/**
 * Live-style bars.beats.sixteenths field over a single beats float.
 *
 * Rest state renders three right-aligned slots, space-separated like Logic's Event List; the dots
 * only appear in the editor and in `aria-valuetext`. Dragging a segment vertically scrubs in that
 * segment's unit (bar, beat or sixteenth; Logic's per-unit drag). Shift drops to a sixteenth on the bar
 * and beat segments and to 1/128 on the sixteenth segment, so an off-grid value is reachable without
 * typing a float. Scrubbing adds to the raw beats, so sub-sixteenth remainders survive coarse drags.
 * Off-grid values display rounded to the nearest sixteenth with a dimmed marker; the exact value is in
 * the tooltip and in the text field.
 *
 * Rest-state pointer: a single click focuses the field; double-click opens the editor (Logic:
 * "double-click the position indicator, then enter a new value").
 *
 * Rest-state keys:
 * - Enter, Space, F2: open the editor with the bar segment selected.
 * - Digit: open the editor with that digit typed.
 * - Alt+Up/Down: step a sixteenth in place; Shift+Alt for 1/128. Plain arrows bubble to the table,
 *   which uses them to move between cells.
 *
 * Editor keys (Live's typing conventions):
 * - `.`, `,`, space: hop to the next segment; they also parse as separators, so `3.2.2` pastes.
 * - Left/Right: select the previous/next segment whole.
 * - Up/Down: step the segment under the caret; Shift for the fine step.
 * - Missing trailing segments default to the first sixteenth (positions) or zero (lengths).
 * - Enter: commit and stay (Cmd/Ctrl+Enter commits as absolute for a multi-selection).
 * - Tab / Shift+Tab: commit and open the next / previous cell.
 * - Escape: cancel. Blur: commit if valid, otherwise close.
 */
export function BarBeatSixteenthInput({
  label,
  value,
  kind,
  numerator,
  denominator,
  min,
  isDisabled = false,
  isMuted = false,
  onChange,
  onCommit,
  pointerLock,
  isCurrent,
  isEditing,
  editInitial,
  onEditStart,
  onEditEnd,
  onFocus,
  cellId,
}: BarBeatSixteenthInputProps) {
  const meter: Meter = { numerator, denominator };
  const { quartersPerBar, quartersPerBeat } = meterUnits(meter);
  const [pending, setPending] = useState<number | undefined>();
  const [draft, setDraft] = useState<string | null>(null);
  const [isInvalid, setIsInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const rest = useRef<HTMLSpanElement>(null);
  const selectAfterRender = useRef<{ start: number; end: number } | null>(null);
  const cancelling = useRef(false);
  const beats = pending ?? value;
  const exactText = formatBeatTime(value, meter, kind, { exact: true });
  const isOpen = isEditing && !isDisabled;
  // The draft is derived on open so the editor renders with content on its first frame.
  const shownDraft = draft ?? editInitial ?? exactText;

  const commitBeats = (next: number, isMetaHeld = false) => {
    const clamped = Math.max(min, next);
    if (clamped !== value) onCommit(clamped, { isMetaHeld });
  };

  const scrub = useScrub({
    value: beats,
    min,
    onChange: (next) => {
      setPending(next);
      onChange?.(next);
    },
    onCommit: (next, { isMetaHeld }) => {
      setPending(undefined);
      commitBeats(next, isMetaHeld);
    },
    pointerLock,
  });

  const onClick = useDoubleClick(
    () => {
      rest.current?.focus();
    },
    () => {
      onEditStart();
    },
  );

  const closeEditor = (reason: EditEndReason) => {
    setDraft(null);
    setIsInvalid(false);
    cancelling.current = false;
    onEditEnd(reason);
  };

  // Live highlights the bar field on click; left/right then move between fields. A typed digit
  // leaves the caret after it instead.
  useEffect(() => {
    if (!isOpen) return;
    const text = editInitial ?? exactText;
    selectAfterRender.current =
      editInitial === undefined
        ? (segmentRanges(text)[0] ?? { start: 0, end: -1 })
        : { start: text.length, end: text.length };
    setDraft(text);
    // Only the open transition matters; the text is captured then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    const target = input.current;
    const range = selectAfterRender.current;
    if (!isOpen || target === null || range === null) return;
    selectAfterRender.current = null;
    target.setSelectionRange(
      range.start,
      range.end === -1 ? shownDraft.length : range.end,
    );
  }, [isOpen, shownDraft]);

  const units = [
    { step: quartersPerBar, fineStep: SIXTEENTH },
    { step: quartersPerBeat, fineStep: SIXTEENTH },
    { step: SIXTEENTH, fineStep: MIN_DURATION },
  ];

  const stepDraft = (text: string, direction: 1 | -1, fine: boolean) => {
    const target = input.current;
    const parsed = parseBeatTime(text, meter, kind);
    if (target === null || parsed === null) return;
    const ranges = segmentRanges(text);
    const caret = target.selectionStart ?? text.length;
    let index = ranges.findIndex((range) => caret <= range.end);
    if (index === -1) index = ranges.length - 1;
    const unit = units[Math.min(index, units.length - 1)];
    if (unit === undefined) return;
    const step = fine ? unit.fineStep : unit.step;
    const next = formatBeatTime(
      Math.max(min, parsed + direction * step),
      meter,
      kind,
      { exact: true },
    );
    const nextRange = segmentRanges(next)[index];
    selectAfterRender.current = nextRange ?? null;
    setIsInvalid(false);
    setDraft(next);
  };

  if (isOpen) {
    /** Parses and commits the draft. Returns false when the text is invalid and the editor stays. */
    const submit = (reason: EditEndReason, isMetaHeld = false): boolean => {
      if (cancelling.current) {
        closeEditor("cancel");
        return true;
      }
      const parsed = parseBeatTime(shownDraft, meter, kind);
      if (parsed === null) {
        if (reason === "blur") closeEditor("blur");
        else setIsInvalid(true);
        return false;
      }
      commitBeats(parsed, isMetaHeld);
      closeEditor(reason);
      return true;
    };
    return (
      <TextInput
        label={label}
        isLabelHidden
        size="sm"
        width="100%"
        value={shownDraft}
        ref={input}
        hasAutoFocus
        status={isInvalid ? { type: "error" } : undefined}
        onChange={(text) => {
          setIsInvalid(false);
          setDraft(text);
        }}
        onBlur={() => {
          submit("blur");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Handled here rather than `onEnter` so the modifier state reaches the commit.
            event.preventDefault();
            submit("commit", event.metaKey || event.ctrlKey);
            return;
          }
          if (event.key === "Tab") {
            event.preventDefault();
            submit(event.shiftKey ? "previous" : "next");
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelling.current = true;
            closeEditor("cancel");
            return;
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            stepDraft(
              shownDraft,
              event.key === "ArrowUp" ? 1 : -1,
              event.shiftKey,
            );
            return;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            // Live: left/right select the previous/next field (Bar/Beat/16th) as a whole.
            event.preventDefault();
            const target = event.currentTarget;
            const ranges = segmentRanges(shownDraft);
            const caret = target.selectionStart ?? 0;
            let index = ranges.findIndex((range) => caret <= range.end);
            if (index === -1) index = ranges.length - 1;
            const next =
              ranges[index + (event.key === "ArrowRight" ? 1 : -1)] ??
              ranges[index];
            if (next !== undefined)
              target.setSelectionRange(next.start, next.end);
            return;
          }
          if (event.key === "." || event.key === "," || event.key === " ") {
            const target = event.currentTarget;
            const ranges = segmentRanges(shownDraft);
            const caret = target.selectionStart ?? 0;
            const index = ranges.findIndex((range) => caret <= range.end);
            const next = index === -1 ? undefined : ranges[index + 1];
            if (
              next !== undefined &&
              target.selectionStart === target.selectionEnd
            ) {
              // Live: `.` and `,` go to the next field. Otherwise the key inserts a separator.
              event.preventDefault();
              target.setSelectionRange(next.start, next.end);
            }
          }
        }}
      />
    );
  }

  const offGrid = isOffGrid(beats);
  const text = formatBeatTime(beats, meter, kind);
  const shownExact = formatBeatTime(beats, meter, kind, { exact: true });
  const segments = text.split(".");
  const bindings = units.map((unit) =>
    isDisabled ? {} : scrub.bind({ ...unit, onClick }),
  );

  return (
    <span
      role="spinbutton"
      aria-label={label}
      aria-valuenow={beats}
      aria-valuemin={min}
      aria-valuetext={shownExact}
      aria-disabled={isDisabled || undefined}
      tabIndex={!isDisabled && isCurrent ? 0 : -1}
      data-cell={cellId}
      ref={rest}
      {...stylex.props(styles.rest)}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if (isDisabled) return;
        if (event.key === "Enter" || event.key === " " || event.key === "F2") {
          event.preventDefault();
          onEditStart();
        } else if (/^\d$/.test(event.key)) {
          event.preventDefault();
          onEditStart(event.key);
        } else if (
          event.altKey &&
          (event.key === "ArrowUp" || event.key === "ArrowDown")
        ) {
          event.preventDefault();
          const step = event.shiftKey ? MIN_DURATION : SIXTEENTH;
          commitBeats(beats + (event.key === "ArrowUp" ? step : -step));
        }
      }}
    >
      <span
        {...stylex.props(
          styles.slots,
          cellTextStyles.base,
          (isDisabled || isMuted) && cellTextStyles.secondary,
        )}
      >
        {segments.map((segment, index) => (
          <span
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            {...stylex.props(styles.segment)}
            {...bindings[index]}
          >
            {segment}
          </span>
        ))}
      </span>
      {offGrid && (
        <span
          aria-hidden
          {...stylex.props(
            cellTextStyles.base,
            cellTextStyles.secondary,
            styles.offGrid,
          )}
        >
          +
        </span>
      )}
    </span>
  );
}
