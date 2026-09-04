import { useRef } from "react";

import { NumberInput } from "@astryxdesign/core/NumberInput";

import { precisionOf, useScrub } from "@/components/useScrub";

interface ScrubbableNumberInputProps {
  label: string;
  description?: string;
  value: number;
  /** Fires on every step so the field tracks the gesture. */
  onChange: (value: number) => void;
  /**
   * Fires once per gesture when a scrub is released, typed text is confirmed with Enter, or the
   * field blurs with a changed value. Escape restores the pre-gesture value without committing.
   */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step: number;
  isIntegerOnly?: boolean;
  width?: number | string;
  /** See `useScrub`'s `pointerLock`. */
  pointerLock?: boolean;
}

/**
 * DAW-style numeric field: click to type, drag vertically to scrub. Wraps Astryx `NumberInput`, which
 * keeps the label, native number input, keyboard stepping, validation and screen-reader semantics; the
 * gesture itself lives in `useScrub`. Astryx spreads unknown props onto its `<input>`, which is how the
 * pointer handlers and `ref` reach the real element.
 *
 * Focus rules: the gesture owns pointerdown and prevents the native caret drag, so click-to-type is done
 * by hand on release (focus and select all, like Live). A press on a focused field, or a scrub starting
 * while any other field is focused, blurs it first. Astryx keeps typed text as pending state and
 * re-commits it on blur, so an unblurred field would show stale text during a scrub and then overwrite
 * the scrubbed value. One active value editor at a time avoids that whole class of bug.
 */
export function ScrubbableNumberInput({
  label,
  description,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  isIntegerOnly,
  width,
  pointerLock = false,
}: ScrubbableNumberInputProps) {
  const cancelling = useRef(false);
  const scrub = useScrub({
    value,
    min,
    max,
    precision: precisionOf(step),
    onChange,
    onCommit,
    pointerLock,
    wheel: { step },
  });
  const handlers = scrub.bind({
    step,
    onClick: (event) => {
      const target = event.currentTarget;
      target.focus();
      if (target instanceof HTMLInputElement) target.select();
    },
  });

  return (
    <NumberInput
      label={label}
      description={description}
      value={value}
      onChange={(next) => {
        if (next === null) return;
        scrub.track(next);
        onChange(next);
      }}
      onEnter={() => {
        scrub.commit();
      }}
      onFocus={() => {
        if (!scrub.isScrubbing()) scrub.rest();
      }}
      onBlur={() => {
        if (cancelling.current) {
          // Astryx has just re-committed its pending text; put the resting value back.
          cancelling.current = false;
          scrub.revert();
          return;
        }
        scrub.commit();
      }}
      min={min}
      max={max}
      step={step}
      isIntegerOnly={isIntegerOnly ?? Number.isInteger(step)}
      width={width}
      ref={scrub.ref as React.Ref<HTMLInputElement>}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelling.current = true;
          event.currentTarget.blur();
          return;
        }
        if (
          event.key.length !== 1 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          /[0-9+-]/.test(event.key) ||
          (!Number.isInteger(step) && /[.,]/.test(event.key))
        )
          return;
        event.preventDefault();
      }}
      {...handlers}
    />
  );
}
