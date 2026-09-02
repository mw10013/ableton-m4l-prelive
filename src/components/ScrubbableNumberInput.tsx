import { useEffect, useRef } from "react";

import { NumberInput } from "@astryxdesign/core/NumberInput";

interface ScrubbableNumberInputProps {
  label: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step: number;
  isIntegerOnly?: boolean;
  width?: number | string;
}

const SCRUB_THRESHOLD = 3;
const PIXELS_PER_STEP = 8;
const FINE_SENSITIVITY = 4;
const WHEEL_PIXELS_PER_STEP = 40;

const clamp = (value: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));

const precisionOf = (value: number) => {
  const [, fraction = ""] = String(value).split(".");
  return fraction.length;
};

/**
 * Keeps ordinary number entry intact until vertical motion crosses a small threshold, so a click can
 * still focus and edit text while a drag becomes an anchored, bounded value adjustment.
 */
export function ScrubbableNumberInput({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  isIntegerOnly,
  width,
}: ScrubbableNumberInputProps) {
  const scrub = useRef<{
    readonly pointerId: number;
    readonly startY: number;
    readonly startValue: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const wheelRemainder = useRef(0);

  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    const target = input.current;
    if (target === null) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || event.ctrlKey) return;
      event.preventDefault();
      let unit = 1;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) unit = 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
        unit = window.innerHeight;
      const delta = event.deltaY * unit;
      const pixelsPerStep = event.shiftKey
        ? WHEEL_PIXELS_PER_STEP * FINE_SENSITIVITY
        : WHEEL_PIXELS_PER_STEP;
      wheelRemainder.current += delta;
      const steps = Math.trunc(wheelRemainder.current / pixelsPerStep);
      if (steps === 0) return;
      wheelRemainder.current -= steps * pixelsPerStep;
      const next = valueRef.current - steps * step;
      onChangeRef.current(
        Number(clamp(next, min, max).toFixed(precisionOf(step))),
      );
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      target.removeEventListener("wheel", onWheel);
    };
  }, [min, max, step]);

  return (
    <NumberInput
      label={label}
      description={description}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      isIntegerOnly={isIntegerOnly}
      width={width}
      ref={input}
      onKeyDown={(event) => {
        if (
          event.key.length !== 1 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          /[0-9+-]/.test(event.key) ||
          (!isIntegerOnly && event.key === ".")
        )
          return;
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.pointerType === "touch") return;
        scrub.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startValue: value,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const activeScrub = scrub.current;
        if (activeScrub?.pointerId !== event.pointerId) return;
        const distance = activeScrub.startY - event.clientY;
        if (Math.abs(distance) < SCRUB_THRESHOLD) return;
        event.preventDefault();
        const next =
          activeScrub.startValue +
          Math.round(
            distance /
              (event.shiftKey
                ? PIXELS_PER_STEP * FINE_SENSITIVITY
                : PIXELS_PER_STEP),
          ) *
            step;
        onChange(Number(clamp(next, min, max).toFixed(precisionOf(step))));
      }}
      onPointerUp={(event) => {
        if (scrub.current?.pointerId === event.pointerId) scrub.current = null;
      }}
      onPointerCancel={() => {
        scrub.current = null;
      }}
      onLostPointerCapture={() => {
        scrub.current = null;
      }}
    />
  );
}
