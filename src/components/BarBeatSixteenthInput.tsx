import { useEffect, useRef, useState } from "react";

import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { colorVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

import { useScrub } from "@/components/useScrub";
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
  segment: {
    cursor: "ns-resize",
    userSelect: "none",
  },
  separator: {
    userSelect: "none",
  },
});

export interface BarBeatSixteenthInputProps {
  label: string;
  /** Quarter-note beats. */
  value: number;
  kind: BeatTimeKind;
  numerator: number;
  denominator: number;
  min: number;
  isDisabled?: boolean;
  /** Fires on every scrub step so a parent can mirror the gesture. */
  onChange?: (beats: number) => void;
  /** Fires once per gesture (scrub release, Enter, blur with a change). Escape never commits. */
  onCommit: (beats: number) => void;
  /** See `useScrub`'s `pointerLock`. */
  pointerLock?: boolean;
}

/**
 * Live-style bars.beats.sixteenths field over a single beats float.
 *
 * Rest state renders three tabular-number segments. Dragging a segment vertically scrubs in that
 * segment's unit (bar, beat or sixteenth; Logic's per-unit drag). Shift drops to a sixteenth on the bar
 * and beat segments and to 1/128 on the sixteenth segment, so an off-grid value is reachable without
 * typing a float. Scrubbing adds to the raw beats, so sub-sixteenth remainders survive coarse drags.
 * Off-grid values display rounded to the nearest sixteenth with a dimmed marker; the exact value is in
 * the tooltip and in the text field.
 *
 * A click, Enter, Space or a typed digit opens one text field with Live's typing conventions: `.`,
 * `,` or space hop to the next segment (and are accepted as separators when parsing), missing
 * trailing segments default to the first sixteenth (positions) or zero (lengths), up/down step the
 * segment containing the caret, Enter commits, Escape cancels. Segment overflow carries.
 */
export function BarBeatSixteenthInput({
  label,
  value,
  kind,
  numerator,
  denominator,
  min,
  isDisabled = false,
  onChange,
  onCommit,
  pointerLock,
}: BarBeatSixteenthInputProps) {
  const meter: Meter = { numerator, denominator };
  const { quartersPerBar, quartersPerBeat } = meterUnits(meter);
  const [pending, setPending] = useState<number | undefined>();
  const [draft, setDraft] = useState<string | null>(null);
  const [isInvalid, setIsInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selectAfterRender = useRef<{ start: number; end: number } | null>(null);
  const cancelling = useRef(false);
  const beats = pending ?? value;

  const commitBeats = (next: number) => {
    const clamped = Math.max(min, next);
    if (clamped !== value) onCommit(clamped);
  };

  const scrub = useScrub({
    value: beats,
    min,
    onChange: (next) => {
      setPending(next);
      onChange?.(next);
    },
    onCommit: (next) => {
      setPending(undefined);
      commitBeats(next);
    },
    pointerLock,
  });

  const openEditor = (initial?: string) => {
    if (isDisabled) return;
    setIsInvalid(false);
    const text = formatBeatTime(value, meter, kind, { exact: true });
    setDraft(initial ?? text);
    // Live highlights the bar field on click; left/right then move between fields.
    selectAfterRender.current =
      initial === undefined
        ? (segmentRanges(text)[0] ?? { start: 0, end: -1 })
        : { start: initial.length, end: initial.length };
  };
  const closeEditor = () => {
    setDraft(null);
    setIsInvalid(false);
    cancelling.current = false;
  };

  useEffect(() => {
    const target = input.current;
    const range = selectAfterRender.current;
    if (draft === null || target === null || range === null) return;
    selectAfterRender.current = null;
    target.setSelectionRange(
      range.start,
      range.end === -1 ? draft.length : range.end,
    );
  }, [draft]);

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

  if (draft !== null) {
    const submit = (viaBlur: boolean) => {
      if (cancelling.current) {
        closeEditor();
        return;
      }
      const parsed = parseBeatTime(draft, meter, kind);
      if (parsed === null) {
        if (viaBlur) closeEditor();
        else setIsInvalid(true);
        return;
      }
      commitBeats(parsed);
      closeEditor();
    };
    return (
      <TextInput
        label={label}
        isLabelHidden
        size="sm"
        width="100%"
        value={draft}
        ref={input}
        hasAutoFocus
        status={isInvalid ? { type: "error" } : undefined}
        onChange={(text) => {
          setIsInvalid(false);
          setDraft(text);
        }}
        onEnter={() => {
          submit(false);
        }}
        onBlur={() => {
          submit(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelling.current = true;
            event.currentTarget.blur();
            return;
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            stepDraft(draft, event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
            return;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            // Live: left/right select the previous/next field (Bar/Beat/16th) as a whole.
            event.preventDefault();
            const target = event.currentTarget;
            const ranges = segmentRanges(draft);
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
            const ranges = segmentRanges(draft);
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
  const exactText = formatBeatTime(beats, meter, kind, { exact: true });
  const segments = text.split(".");
  const bindings = units.map((unit) =>
    isDisabled
      ? {}
      : scrub.bind({
          ...unit,
          onClick: () => {
            openEditor();
          },
        }),
  );

  return (
    <span
      role="spinbutton"
      aria-label={label}
      aria-valuenow={beats}
      aria-valuemin={min}
      aria-valuetext={exactText}
      aria-disabled={isDisabled || undefined}
      tabIndex={isDisabled ? -1 : 0}
      {...stylex.props(styles.rest)}
      onKeyDown={(event) => {
        if (isDisabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openEditor();
        } else if (/^\d$/.test(event.key)) {
          event.preventDefault();
          openEditor(event.key);
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const step = event.shiftKey ? MIN_DURATION : SIXTEENTH;
          commitBeats(beats + (event.key === "ArrowUp" ? step : -step));
        }
      }}
    >
      <Text
        type="supporting"
        color={isDisabled ? "secondary" : "primary"}
        hasTabularNumbers
      >
        {segments.map((segment, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <span key={index}>
            {index > 0 && <span {...stylex.props(styles.separator)}>.</span>}
            <span {...stylex.props(styles.segment)} {...bindings[index]}>
              {segment}
            </span>
          </span>
        ))}
      </Text>
      {offGrid && (
        <Text type="supporting" color="secondary" aria-hidden>
          +
        </Text>
      )}
    </span>
  );
}
