import { useEffect, useRef } from "react";

import { NumberInput } from "@astryxdesign/core/NumberInput";

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
  /**
   * Hide the cursor and use unlimited relative movement while scrubbing, like Live. Falls back to
   * plain pointer capture when the browser refuses the lock.
   *
   * Trade-off: browsers show a "press Esc to exit" notice on every lock. That is security UI and cannot
   * be suppressed. Chrome also refuses a re-lock within about a second of an exit, which is why the
   * capture fallback must stay. The alternative, `cursor: none` during a capture drag, hides the cursor
   * without the notice but cannot restore it to the press point and is limited by the screen edge.
   */
  pointerLock?: boolean;
}

/** Vertical CSS pixels a press may drift before it stops being a click. Must stay below half a step. */
const SCRUB_THRESHOLD = 3;
/** Live-like feel on a trackpad; a 0-127 velocity field spans about 1000 px. Time fields may want more. */
const PIXELS_PER_STEP = 8;
/** Shift multiplies the pixels per step, per Live's "Shift while dragging gives finer resolution". */
const FINE_SENSITIVITY = 4;
const WHEEL_PIXELS_PER_STEP = 40;
/** Wheel has no release event, so a commit is scheduled after this much idle time. */
const WHEEL_COMMIT_DELAY = 300;

interface Scrub {
  readonly pointerId: number;
  /** Virtual vertical position, increasing upward: -clientY until pointer lock, then accumulated movementY. */
  pos: number;
  anchorPos: number;
  anchorValue: number;
  shift: boolean;
  started: boolean;
  lockRequested: boolean;
  locked: boolean;
  /** Set while we exit the lock ourselves so the resulting pointerlockchange is not read as a cancel. */
  releasing: boolean;
}

const clamp = (value: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));

/** Rounds half away from zero so an upward and downward drag of equal size take the same step. */
const roundSymmetric = (value: number) =>
  Math.sign(value) * Math.round(Math.abs(value));

const precisionOf = (value: number) => {
  const text = String(value);
  const exponent = /e-(\d+)$/i.exec(text);
  const [mantissa = ""] = text.split(/e/i);
  const [, fraction = ""] = mantissa.split(".");
  return fraction.length + (exponent ? Number(exponent[1]) : 0);
};

/**
 * DAW-style numeric field: click to type, drag vertically to scrub. Wraps Astryx `NumberInput`, which
 * keeps the label, native number input, keyboard stepping, validation and screen-reader semantics; this
 * wrapper only adds the pointer gesture. Astryx spreads unknown props onto its `<input>`, which is how
 * the pointer handlers and `ref` reach the real element.
 *
 * Precedent: Live edits Arrangement Position, Scene Tempo, Delay Time and Meld envelope values by
 * dragging up/down or typing, with Shift for fine resolution, Enter to confirm and Escape to cancel.
 * On macOS the observed Live gesture is three-finger drag (an Accessibility option), which the OS
 * delivers as a held-button drag, so it arrives here as pointerdown/pointermove, not as wheel events.
 *
 * Gesture contract:
 * - Up increases, down decreases, one `step` per PIXELS_PER_STEP of vertical movement.
 * - The value is computed from the absolute distance to an anchor, never by accumulating deltas, so
 *   event frequency cannot change the result and `movementY`'s browser-specific units are avoided
 *   outside pointer lock, where they are the only source.
 * - The anchor is the press value, re-anchored at the current position in two cases: Shift changing
 *   mid-drag (otherwise the whole distance is re-divided and the value jumps), and overshooting a
 *   bound (Live absorbs overshoot so reversing responds at once, with no dead zone).
 * - Once the threshold is crossed the gesture stays active, so returning to the origin restores the
 *   press value instead of being ignored.
 * - Escape restores the value from before the gesture, both while dragging and while typing.
 * - `onChange` fires per step so the field tracks; `onCommit` fires once on release, Enter or blur, and
 *   is the only thing that should write to Live. Escape never commits.
 * - Mouse and pen only. Touch keeps native behaviour and page scrolling.
 *
 * Focus rules: the wrapper owns pointerdown and prevents the native caret drag, so click-to-type is done
 * by hand on release (focus and select all, like Live). A press on a focused field, or a scrub starting
 * while any other field is focused, blurs it first. Astryx keeps typed text as pending state and
 * re-commits it on blur, so an unblurred field would show stale text during a scrub and then overwrite
 * the scrubbed value. One active value editor at a time avoids that whole class of bug.
 *
 * Wheel is a secondary two-finger convenience, not the Live gesture. Its known problems: the browser
 * cannot see the OS natural-scrolling setting, so its sign can be inverted relative to drag; trackpad
 * inertia keeps stepping after the fingers lift; and there is no release event, so commit is by idle
 * timer. Delete it if it stays unused.
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
  const scrub = useRef<Scrub | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const restingValue = useRef(value);
  const cancelling = useRef(false);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const wheelRemainder = useRef(0);
  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  valueRef.current = value;
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;

  const precision = precisionOf(step);
  const emit = (next: number) => {
    const rounded = Number(clamp(next, min, max).toFixed(precision));
    if (rounded === valueRef.current) return rounded;
    valueRef.current = rounded;
    onChangeRef.current(rounded);
    return rounded;
  };
  const commit = () => {
    if (valueRef.current === restingValue.current) return;
    restingValue.current = valueRef.current;
    onCommitRef.current?.(valueRef.current);
  };

  useEffect(() => {
    const target = input.current;
    if (target === null) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || scrub.current !== null) return;
      // macOS browsers turn Shift+wheel into horizontal delta; read either axis in fine mode.
      const rawDelta =
        event.deltaY !== 0 || !event.shiftKey ? event.deltaY : event.deltaX;
      if (rawDelta === 0) return;
      event.preventDefault();
      let unit = 1;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) unit = 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
        unit = window.innerHeight;
      const pixelsPerStep = event.shiftKey
        ? WHEEL_PIXELS_PER_STEP * FINE_SENSITIVITY
        : WHEEL_PIXELS_PER_STEP;
      wheelRemainder.current += rawDelta * unit;
      const steps = Math.trunc(wheelRemainder.current / pixelsPerStep);
      if (steps !== 0) {
        wheelRemainder.current -= steps * pixelsPerStep;
        emit(valueRef.current - steps * step);
      }
      if (wheelCommitTimer.current !== null)
        clearTimeout(wheelCommitTimer.current);
      wheelCommitTimer.current = setTimeout(() => {
        wheelCommitTimer.current = null;
        commit();
      }, WHEEL_COMMIT_DELAY);
    };
    const onLeave = () => {
      wheelRemainder.current = 0;
    };
    // React registers wheel listeners as passive, so a native listener is needed to preventDefault.
    target.addEventListener("wheel", onWheel, { passive: false });
    target.addEventListener("pointerleave", onLeave);
    return () => {
      target.removeEventListener("wheel", onWheel);
      target.removeEventListener("pointerleave", onLeave);
      if (wheelCommitTimer.current !== null)
        clearTimeout(wheelCommitTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, step, precision]);

  const endScrub = (cancel: boolean) => {
    const active = scrub.current;
    if (active === null) return;
    if (active.locked && document.pointerLockElement === input.current) {
      active.releasing = true;
      document.exitPointerLock();
    }
    scrub.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (cancel) emit(restingValue.current);
    else if (active.started) commit();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || scrub.current === null) return;
      event.preventDefault();
      endScrub(true);
    };
    const onLockChange = () => {
      const active = scrub.current;
      if (active === null) return;
      if (document.pointerLockElement === input.current) {
        active.locked = true;
        document.body.style.cursor = "";
      } else if (active.locked && !active.releasing) {
        // The browser dropped the lock (Escape, focus loss). Live treats this as cancel.
        active.locked = false;
        endScrub(true);
      }
    };
    const onLockError = () => {
      const active = scrub.current;
      if (active === null) return;
      active.lockRequested = false;
      document.body.style.cursor = "ns-resize";
      try {
        input.current?.setPointerCapture(active.pointerId);
      } catch {
        endScrub(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("pointerlockerror", onLockError);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onLockError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startScrub = (active: Scrub) => {
    active.started = true;
    // One active value editor at a time: commit any other field's typed text before this gesture.
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    active.anchorPos = active.pos;
    active.anchorValue = valueRef.current;
    document.body.style.userSelect = "none";
    if (pointerLock && input.current?.requestPointerLock) {
      active.lockRequested = true;
      // Chrome returns a promise that rejects when the lock is refused; pointerlockerror covers it.
      const result = input.current.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => null);
    }
    if (!document.pointerLockElement) document.body.style.cursor = "ns-resize";
  };

  return (
    <NumberInput
      label={label}
      description={description}
      value={value}
      onChange={(next) => {
        if (next === null) return;
        valueRef.current = next;
        onChange(next);
      }}
      onEnter={commit}
      onBlur={() => {
        if (cancelling.current) {
          // Astryx has just re-committed its pending text; put the resting value back.
          cancelling.current = false;
          emit(restingValue.current);
          return;
        }
        commit();
      }}
      min={min}
      max={max}
      step={step}
      isIntegerOnly={isIntegerOnly ?? Number.isInteger(step)}
      width={width}
      ref={input}
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
      onPointerDown={(event) => {
        if (event.button !== 0 || event.pointerType === "touch") return;
        if (scrub.current !== null) return;
        // Own the gesture: no caret placement or text selection until we decide it was a click.
        event.preventDefault();
        const target = event.currentTarget;
        // Commit any typed text first so the scrub anchors to a settled value.
        if (document.activeElement === target) target.blur();
        try {
          target.setPointerCapture(event.pointerId);
        } catch {
          return;
        }
        scrub.current = {
          pointerId: event.pointerId,
          pos: -event.clientY,
          anchorPos: -event.clientY,
          anchorValue: valueRef.current,
          shift: event.shiftKey,
          started: false,
          lockRequested: false,
          locked: false,
          releasing: false,
        };
      }}
      onPointerMove={(event) => {
        const active = scrub.current;
        if (active === null || active.pointerId !== event.pointerId) return;
        if ((event.buttons & 1) === 0) {
          // Button already up without a pointerup reaching us (focus loss mid-drag).
          endScrub(false);
          return;
        }
        active.pos = active.locked
          ? active.pos - event.movementY
          : -event.clientY;
        if (!active.started) {
          if (Math.abs(active.pos - active.anchorPos) < SCRUB_THRESHOLD) return;
          startScrub(active);
        }
        if (event.shiftKey !== active.shift) {
          // Modifier changed mid-gesture: continue from here instead of re-dividing the whole drag.
          active.shift = event.shiftKey;
          active.anchorPos = active.pos;
          active.anchorValue = valueRef.current;
        }
        const pixelsPerStep = active.shift
          ? PIXELS_PER_STEP * FINE_SENSITIVITY
          : PIXELS_PER_STEP;
        const steps = roundSymmetric(
          (active.pos - active.anchorPos) / pixelsPerStep,
        );
        const raw = active.anchorValue + steps * step;
        const next = emit(raw);
        if (clamp(raw, min, max) !== raw) {
          // Overshoot past a bound is absorbed so reversing direction responds at once.
          active.anchorPos = active.pos;
          active.anchorValue = next;
        }
      }}
      onPointerUp={(event) => {
        const active = scrub.current;
        if (active === null || active.pointerId !== event.pointerId) return;
        const wasClick = !active.started;
        endScrub(false);
        if (wasClick) {
          const target = input.current;
          target?.focus();
          target?.select();
        }
      }}
      onPointerCancel={() => {
        endScrub(false);
      }}
      onLostPointerCapture={() => {
        // Engaging pointer lock can release capture; the locked element keeps receiving events anyway.
        if (scrub.current?.lockRequested) return;
        endScrub(false);
      }}
    />
  );
}
