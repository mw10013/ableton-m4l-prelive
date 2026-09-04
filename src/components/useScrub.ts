import { useEffect, useRef } from "react";

/** Vertical CSS pixels a press may drift before it stops being a click. Must stay below half a step. */
const SCRUB_THRESHOLD = 3;
/** Live-like feel on a trackpad; a 0-127 velocity field spans about 1000 px. Time fields may want more. */
const PIXELS_PER_STEP = 8;
/** Shift multiplies the pixels per step when a unit has no `fineStep`, per Live's "Shift while dragging gives finer resolution". */
const FINE_SENSITIVITY = 4;
const WHEEL_PIXELS_PER_STEP = 40;
/** Wheel has no release event, so a commit is scheduled after this much idle time. */
const WHEEL_COMMIT_DELAY = 300;

export interface ScrubUnit {
  /** Value change per PIXELS_PER_STEP of vertical movement. */
  step: number;
  /**
   * Step used while Shift is held. When omitted, Shift keeps `step` and needs FINE_SENSITIVITY times
   * more movement per step instead.
   */
  fineStep?: number;
}

export interface ScrubBinding extends ScrubUnit {
  /** Fires on release when the press never crossed the scrub threshold. */
  onClick?: (event: React.PointerEvent<HTMLElement>) => void;
}

export interface UseScrubOptions {
  value: number;
  min?: number;
  max?: number;
  /**
   * Decimal places emitted values are rounded to. Defaults to 9, which removes float noise while keeping
   * remainders finer than the step (a bar-sized scrub must not truncate a sixteenth). Pass the step's
   * own precision to snap the value to the step grid instead.
   */
  precision?: number;
  /** Fires on every step so the field tracks the gesture. */
  onChange: (value: number) => void;
  /**
   * Fires once per gesture on release or wheel idle. Escape restores the pre-gesture value without
   * committing. `isMetaHeld` reports Cmd (macOS) or Ctrl held at release so a caller can give the
   * commit a second meaning; wheel commits never report it.
   */
  onCommit?: (value: number, options: ScrubCommitOptions) => void;
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
  /**
   * Enable wheel stepping on the element attached to the returned `ref`. Wheel is a secondary
   * two-finger convenience, not the Live gesture. Its known problems: the browser cannot see the OS
   * natural-scrolling setting, so its sign can be inverted relative to drag; trackpad inertia keeps
   * stepping after the fingers lift; and there is no release event, so commit is by idle timer.
   */
  wheel?: ScrubUnit;
}

export interface ScrubCommitOptions {
  readonly isMetaHeld: boolean;
}

export interface ScrubHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
}

interface Scrub {
  readonly pointerId: number;
  readonly element: HTMLElement;
  readonly unit: ScrubUnit;
  /** Virtual vertical position, increasing upward: -clientY until pointer lock, then accumulated movementY. */
  pos: number;
  anchorPos: number;
  anchorValue: number;
  shift: boolean;
  meta: boolean;
  started: boolean;
  lockRequested: boolean;
  locked: boolean;
  /** Set while we exit the lock ourselves so the resulting pointerlockchange is not read as a cancel. */
  releasing: boolean;
}

/** The element's own `cursor` style beats the body's, so both are set. */
const hideCursor = (element: HTMLElement) => {
  document.body.style.cursor = "none";
  element.style.cursor = "none";
};

const clamp = (value: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));

/** Rounds half away from zero so an upward and downward drag of equal size take the same step. */
const roundSymmetric = (value: number) =>
  Math.sign(value) * Math.round(Math.abs(value));

export const precisionOf = (value: number) => {
  const text = String(value);
  const exponent = /e-(\d+)$/i.exec(text);
  const [mantissa = ""] = text.split(/e/i);
  const [, fraction = ""] = mantissa.split(".");
  return fraction.length + (exponent ? Number(exponent[1]) : 0);
};

/**
 * DAW-style vertical scrub gesture for any element. `bind(unit)` returns pointer handlers to spread on
 * an element; several elements can share one hook with different units, which is how a
 * bar.beat.sixteenth field scrubs the segment under the pointer in that segment's unit.
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
 * - Escape restores the value from before the gesture.
 * - `onChange` fires per step so the field tracks; `onCommit` fires once on release and is the only
 *   thing that should write to Live. Escape never commits.
 * - Mouse and pen only. Touch keeps native behaviour and page scrolling.
 * - The press owns the pointer (no caret placement or text selection); a press that never moves past
 *   the threshold is reported through the binding's `onClick` on release.
 *
 * One active value editor at a time: a scrub starting while any element is focused blurs it first, so
 * a text field cannot re-commit stale pending text over the scrubbed value.
 */
export function useScrub({
  value,
  min,
  max,
  precision = 9,
  onChange,
  onCommit,
  pointerLock = true,
  wheel,
}: UseScrubOptions) {
  const scrub = useRef<Scrub | null>(null);
  const ref = useRef<HTMLElement | null>(null);
  const valueRef = useRef(value);
  const restingValue = useRef(value);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const wheelRemainder = useRef(0);
  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  valueRef.current = value;
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;

  const emit = (next: number) => {
    const rounded = Number(clamp(next, min, max).toFixed(precision));
    if (rounded === valueRef.current) return rounded;
    valueRef.current = rounded;
    onChangeRef.current(rounded);
    return rounded;
  };
  const commit = (isMetaHeld = false) => {
    if (valueRef.current === restingValue.current) return;
    restingValue.current = valueRef.current;
    onCommitRef.current?.(valueRef.current, { isMetaHeld });
  };
  /** Marks the tracked value as the value Escape returns to. Called at the start of every gesture. */
  const rest = () => {
    restingValue.current = valueRef.current;
  };
  const revert = () => {
    emit(restingValue.current);
  };

  const wheelStep = wheel?.step;
  const wheelFineStep = wheel?.fineStep;
  useEffect(() => {
    const target = ref.current;
    if (target === null || wheelStep === undefined) return;
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
      const fine = event.shiftKey;
      const step = fine ? (wheelFineStep ?? wheelStep) : wheelStep;
      const pixelsPerStep =
        fine && wheelFineStep === undefined
          ? WHEEL_PIXELS_PER_STEP * FINE_SENSITIVITY
          : WHEEL_PIXELS_PER_STEP;
      if (wheelCommitTimer.current === null) rest();
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
  }, [min, max, precision, wheelStep, wheelFineStep]);

  const endScrub = (cancel: boolean) => {
    const active = scrub.current;
    if (active === null) return;
    if (active.locked && document.pointerLockElement === active.element) {
      active.releasing = true;
      document.exitPointerLock();
    }
    scrub.current = null;
    document.body.style.cursor = "";
    active.element.style.cursor = "";
    document.body.style.userSelect = "";
    if (cancel) revert();
    else if (active.started) commit(active.meta);
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
      if (document.pointerLockElement === active.element) {
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
      hideCursor(active.element);
      try {
        active.element.setPointerCapture(active.pointerId);
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
      // Unmount mid-gesture: release the pointer lock and body styles without emitting to a parent.
      const active = scrub.current;
      if (active !== null) {
        scrub.current = null;
        if (active.locked && document.pointerLockElement === active.element)
          document.exitPointerLock();
        document.body.style.cursor = "";
        active.element.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startScrub = (active: Scrub) => {
    active.started = true;
    // One active value editor at a time: commit any other field's typed text before this gesture.
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    rest();
    active.anchorPos = active.pos;
    active.anchorValue = valueRef.current;
    document.body.style.userSelect = "none";
    if (pointerLock && active.element.requestPointerLock) {
      active.lockRequested = true;
      // Chrome returns a promise that rejects when the lock is refused; pointerlockerror covers it.
      const result = active.element.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => null);
    }
    // Live hides the pointer while dragging; otherwise it sits on top of the digits being changed.
    if (!document.pointerLockElement) hideCursor(active.element);
  };

  const bind = ({ step, fineStep, onClick }: ScrubBinding): ScrubHandlers => ({
    onPointerDown: (event) => {
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
        element: target,
        unit: { step, fineStep },
        pos: -event.clientY,
        anchorPos: -event.clientY,
        anchorValue: valueRef.current,
        shift: event.shiftKey,
        meta: event.metaKey || event.ctrlKey,
        started: false,
        lockRequested: false,
        locked: false,
        releasing: false,
      };
    },
    onPointerMove: (event) => {
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
      active.meta = event.metaKey || event.ctrlKey;
      if (event.shiftKey !== active.shift) {
        // Modifier changed mid-gesture: continue from here instead of re-dividing the whole drag.
        active.shift = event.shiftKey;
        active.anchorPos = active.pos;
        active.anchorValue = valueRef.current;
      }
      const activeStep = active.shift
        ? (active.unit.fineStep ?? active.unit.step)
        : active.unit.step;
      const pixelsPerStep =
        active.shift && active.unit.fineStep === undefined
          ? PIXELS_PER_STEP * FINE_SENSITIVITY
          : PIXELS_PER_STEP;
      const steps = roundSymmetric(
        (active.pos - active.anchorPos) / pixelsPerStep,
      );
      const raw = active.anchorValue + steps * activeStep;
      const next = emit(raw);
      if (clamp(raw, min, max) !== raw) {
        // Overshoot past a bound is absorbed so reversing direction responds at once.
        active.anchorPos = active.pos;
        active.anchorValue = next;
      }
    },
    onPointerUp: (event) => {
      const active = scrub.current;
      if (active === null || active.pointerId !== event.pointerId) return;
      const wasClick = !active.started;
      active.meta = event.metaKey || event.ctrlKey;
      endScrub(false);
      if (wasClick) onClick?.(event);
    },
    onPointerCancel: () => {
      endScrub(false);
    },
    onLostPointerCapture: () => {
      // Engaging pointer lock can release capture; the locked element keeps receiving events anyway.
      if (scrub.current?.lockRequested) return;
      endScrub(false);
    },
  });

  return {
    bind,
    /** Attach to the element that should receive wheel events (only needed with `wheel`). */
    ref,
    /** True while a press has crossed the scrub threshold. */
    isScrubbing: () => scrub.current?.started === true,
    /** Track a value produced outside the gesture (typed text) without firing `onChange`. */
    track: (next: number) => {
      valueRef.current = next;
    },
    rest,
    revert,
    /** Commit the tracked value now (typed text confirmed); pass the modifier state of the confirming key. */
    commit,
  };
}
