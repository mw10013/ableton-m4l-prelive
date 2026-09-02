# Numeric Scrub Control Research

Research question: can Prelive provide DAW-style vertical mouse scrubbing for numeric values in a web
number input, and what should its first interaction contract be?

## Conclusion

Yes. The web platform can implement this reliably for Prelive's browser support matrix without Pointer
Lock. A numeric input receives a primary-button `pointerdown`, captures that pointer, and calculates the
value from the pointer's vertical displacement until `pointerup` or `pointercancel`. Pointer capture keeps
delivery on the original input after the pointer leaves it; MDN marks it widely available since July 2020.

The proof of concept is `src/components/ScrubbableNumberInput.tsx`, displayed on the home page. It wraps
Astryx `NumberInput`, so typing, native arrow-key stepping, labels, validation, and min/max constraints
remain intact. Astryx `NumberInput` has no scrub prop, but its source forwards unrecognised native input
props to its internal `<input>` (`refs/astryx/packages/core/src/NumberInput/NumberInput.tsx:650-686`).

The recovered [Claude artifact](https://claude.ai/code/artifact/9f6a2caf-afee-4aca-8a81-719870295cab?org=407ec02e-f32c-42c4-8687-7c7bc743b83a)
is organization-gated from this environment. It therefore cannot be treated as a verifiable source here.
The conclusion below is grounded in the checked-in manuals, Astryx source, and platform documentation.

## DAW Precedent

Live explicitly supports the exact interaction in several numeric contexts:

- Arrangement Position fields can be adjusted by dragging up or down, typing and pressing Enter, or using
  the up/down arrow keys (`refs/live-manual/en/live-manual/12/arrangement-view/index.md:70-78`).
- Scene Tempo and Time Signature fields can be changed by dragging up/down or typing and pressing Enter
  (`refs/live-manual/en/live-manual/12/session-view/index.md:70-80`).
- With Delay Time unsynced, its numeric field can be dragged up/down or typed
  (`refs/live-manual/en/live-manual/12/live-audio-effect-reference/index.md:1059-1062`).
- Meld's envelope numeric values are adjusted by “sliding” them up/down, typing, or dragging their graphical
  breakpoint (`refs/live-manual/en/live-manual/12/live-instrument-reference/index.md:967-973`).
- The general value-editing shortcut table specifies up/down arrows for decrement/increment, typing `0…9`,
  Enter to confirm, Escape to cancel, and Shift for finer resolution while dragging
  (`refs/live-manual/en/live-manual/12/live-keyboard-shortcuts/index.md:111-122`).

Live also uses vertical drag on the MIDI canvas: Alt/Option-dragging a selected note changes velocity, and
dragging velocity markers edits their values (`refs/live-manual/en/live-manual/12/editing-midi/index.md:361-377`).
That is a different target from an inline numeric input, but it confirms the direction and selection semantics
for the eventual note-table interaction.

Digital Performer independently supports the exact interaction in several numeric contexts:

- Its Event List says a value text box appears on double-click or Option-click and a new value can be
  entered "by either typing or by dragging up or down"
  (`refs/performer-manual/SIRA/Digital_Performer_Help/pages/event_list.md:13`).
- Its Selection Information documentation says numeric fields can be changed by dragging vertically
  (`refs/performer-manual/SIRA/Digital_Performer_Help/pages/selection_info.md:11-19`).
- Its MIDI plug-in pitch text boxes accept typing, vertical drag, or MIDI entry
  (`refs/performer-manual/SIRA/Digital_Performer_Help/pages/midi_plugins.md:65`).

This validates vertical drag as a familiar DAW editing gesture. Live's documented modifier map gives Prelive
a concrete compatible default: Shift should reduce scrub sensitivity when the interaction is moved from the
prototype into production.

## Requirements

The production control should:

1. Increase while dragging up; decrease while dragging down.
2. Preserve direct text entry and keyboard stepping. A click without material movement must focus the input,
   not change its value.
3. Use the field's existing `step`, `min`, and `max`; it must never emit an out-of-range value.
4. Anchor the entire gesture to the value at press time. Moving back to the press height restores that value;
   event frequency cannot change the result.
5. Continue when the pointer leaves the input, then stop on `pointerup`, `pointercancel`, or lost capture.
6. Be mouse/pen progressive enhancement only. Touch retains the ordinary number-input behavior and page
   scrolling/zooming.
7. Retain normal form semantics: label, native numeric input, keyboard navigation, and assistive-technology
   value announcements remain owned by `NumberInput`.
8. Evaluate hovered wheel input separately from press-and-drag. It is attractive for trackpads, but must only
   consume page scroll while the pointer is directly over the numeric field.

### Live-Compatible Value Rules

Adopt Live's general `Adjusting Values` contract for every numeric field where the action makes sense. These
are product requirements, not a claim that the current proof of concept has all of them yet.

| Live rule                                        | Prelive requirement                                                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Up/down arrow decrements/increments              | Focused field changes by its normal `step`, subject to bounds.                                                                          |
| Shift + up/down gives octaves or fine adjustment | Pitch fields move by an octave; other fields use a field-defined fine step.                                                             |
| Shift while dragging gives finer resolution      | A vertical drag remains anchored to its press value; Shift makes each step require four times as much movement.                         |
| Delete returns to default                        | Support this only when the field has an explicit product default. It must not mean `min`, `0`, or a browser default by accident.        |
| Digits type a value                              | A click enters ordinary text-edit mode; digits, `+`, `-`, and decimal separators are accepted as applicable, while letters are ignored. |
| Escape cancels entry                             | Escape restores the value present when typing or scrubbing began and returns to the resting display.                                    |
| Enter confirms entry                             | Enter commits a valid typed value and leaves a visible, stable value.                                                                   |
| `.`/`,` moves to the next bar/beat/16th field    | Apply only to a future compound musical-time editor, not to a scalar number field.                                                      |

Live documents these rules in `refs/live-manual/en/live-manual/12/live-keyboard-shortcuts/index.md:111-122`.
Its concrete field examples establish that vertical drag and direct typing are alternatives on the same value,
rather than separate controls (`arrangement-view/index.md:76`, `session-view/index.md:72-75`, and
`live-audio-effect-reference/index.md:1061`).

## Prototype Contract

The proof of concept uses a 3 CSS-pixel movement threshold and one `step` per 8 CSS pixels of vertical
movement. The threshold prevents minute hand motion during a click from changing the value. Above it:

```text
steps = round((pressY - currentY) / 8)
next  = clamp(pressValue + steps * step, min, max)
```

The calculation is absolute from the press point rather than accumulating `movementY`. MDN cautions that
`movementY` units vary among browsers and operating systems; `clientY` deltas avoid that ambiguity.

The wrapper rounds to the decimal precision of `step` after calculation, preventing familiar binary floating
point displays such as `0.30000000000000004`.

Shift now uses four times as many vertical pixels per step. The prototype deliberately does not yet implement
Escape cancellation or Delete reset; those require the field-specific definitions in the requirements above.

### Hovered Wheel Experiment

The prototype also listens for a cancelable `wheel` event directly on the input. A vertical wheel/trackpad
gesture while the pointer is over the field increases or decreases the value and prevents the page from
scrolling; Shift makes this four times less sensitive. It accumulates pixel deltas before taking a step, which
keeps high-resolution trackpads from producing a change for every tiny event.

This is the likely web equivalent of the observed Live interaction. Browsers receive `pointermove` when one
finger moves the cursor, while a trackpad scrolling gesture is normally delivered as `wheel`. The browser does
not expose a reliable finger count, so this cannot be specified as "three-finger scrub." It must be tested on
the target macOS/browser setup before it becomes a product requirement.

## Platform Choice

### Pointer events and capture: use

Pointer Events represent mouse, pen, and touch in one model and expose `pointerType` so touch can be left
alone. `setPointerCapture(pointerId)` retargets future events to the control until released or the pointer
ends. This is sufficient for a drag gesture that ends on mouse-up.

Sources:

- [MDN: Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [MDN: Element.setPointerCapture()](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)

### Pointer Lock: do not use initially

Pointer Lock hides the cursor, supplies unlimited relative movement, and permits motion after reaching the
browser or screen edge. It could support exceptionally large adjustments, but it requires an engagement
gesture, has limited availability, and changes the expected escape/release behavior. That is disproportionate
for an inline number field. Normal capture has a natural range limited by the screen; the user can release
and make another gesture.

Source: [MDN: Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API).

### Wheel events: experiment only

The `wheel` event is also fired by trackpads that simulate wheel actions. It is cancelable, allowing the
prototype to prevent page scroll while the pointer is over the field. It has limited Baseline availability, and
the platform warns that wheel deltas are not a general substitute for scroll position; use them here only as a
direct input gesture, never to infer that the page has scrolled.

Source: [MDN: Element wheel event](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event).

## Decisions Still Needed

Test the current prototype with a mouse and trackpad before migrating it into the note table. Then decide:

1. Is 8 pixels per pointer-drag step and 40 wheel pixels per step comfortable for pitch and velocity? Time
   fields may need a field-specific sensitivity.
2. Does hovered wheel input on macOS Safari and Chrome feel like the observed Live interaction, and is
   preventing page scroll while hovering acceptable? If not, remove it rather than adding a finger-count or
   browser heuristic.
3. Should scrubbing a selected note apply the existing relative/absolute group-edit semantics? It should use
   the same operation path as typing, never a second mutation path.
4. What visual affordance is sufficient? The prototype uses instructional text. A future reusable component
   may add a cursor or drag indicator after validating that it does not misrepresent click-to-type behavior.

## Validation Matrix

Before product adoption, manually test Chrome 123+, Firefox 120+, and Safari 17.5+ with:

- Click, type, Enter, blur, ArrowUp, and ArrowDown.
- Up/down scrub, return to the origin, bounds, fractional steps, and fast pointer movement.
- Pointer exiting the field before release, cancellation, and page scroll after release.
- Mouse, trackpad, pen if available, keyboard-only, and touch device behavior.
- A selected multi-note row and both relative and absolute edit modes once the wrapper is connected to the
  note table.
