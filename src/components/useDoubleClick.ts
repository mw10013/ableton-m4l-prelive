import { useRef } from "react";

/** Window for two presses to count as a double-click; matches the common desktop default. */
const DOUBLE_CLICK_MS = 400;

/**
 * Splits a click stream into single and double clicks. Needed because `useScrub` calls
 * `preventDefault` on pointerdown to own the drag, which suppresses the browser's own `dblclick`.
 * The single-click action runs at once (no delay waiting for a second press); a second press within
 * the window runs the double-click action instead.
 */
export function useDoubleClick(
  onSingle: (event: React.PointerEvent<HTMLElement>) => void,
  onDouble: (event: React.PointerEvent<HTMLElement>) => void,
) {
  const last = useRef(0);
  return (event: React.PointerEvent<HTMLElement>) => {
    if (event.timeStamp - last.current < DOUBLE_CLICK_MS) {
      last.current = 0;
      onDouble(event);
    } else {
      last.current = event.timeStamp;
      onSingle(event);
    }
  };
}
