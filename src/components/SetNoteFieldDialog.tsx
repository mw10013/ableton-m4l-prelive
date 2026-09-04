import type { EditableField } from "@/lib/noteEdits";

import { useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

import { noteName } from "@/components/NoteTable";
import { formatBeatTime } from "@/lib/beatTime";
import { FIELD_RANGE } from "@/lib/noteEdits";

export type SettableField = Exclude<EditableField, "start_time">;

export const FIELD_LABEL: Record<SettableField, string> = {
  pitch: "pitch",
  duration: "duration",
  velocity: "velocity",
  probability: "chance",
  velocity_deviation: "velocity deviation",
  release_velocity: "release velocity",
};

/** Dialog units per stored unit: chance is entered as a percentage. */
const SCALE: Record<SettableField, number> = {
  pitch: 1,
  duration: 1,
  velocity: 1,
  probability: 100,
  velocity_deviation: 1,
  release_velocity: 1,
};

const DESCRIPTION: Partial<Record<SettableField, string>> = {
  duration: "In quarter notes.",
  probability: "Percent chance the note plays.",
};

const STEP: Record<SettableField, number> = {
  pitch: 1,
  duration: 0.25,
  velocity: 1,
  probability: 1,
  velocity_deviation: 1,
  release_velocity: 1,
};

interface SetNoteFieldDialogProps {
  field: SettableField;
  count: number;
  /** Stored units (beats for duration, 0..1 for probability). */
  initialValue: number;
  signatureNumerator: number;
  signatureDenominator: number;
  onClose: () => void;
  /** Stored units. */
  onConfirm: (value: number) => void;
}

/**
 * "Set the same value for every selected note", as an explicit command. The Cmd-held commit in the
 * table does the same thing, but a menu item is discoverable and works for a value the user has
 * not yet typed anywhere. Precedent: Live's Note Duration utility sets one length for all selected
 * notes; Performer's Region commands do the same for velocity and duration.
 */
export function SetNoteFieldDialog({
  field,
  count,
  initialValue,
  signatureNumerator,
  signatureDenominator,
  onClose,
  onConfirm,
}: SetNoteFieldDialogProps) {
  const scale = SCALE[field];
  const { min, max } = FIELD_RANGE[field];
  const [value, setValue] = useState<number | null>(
    Math.round(initialValue * scale * 1000) / 1000,
  );
  const isValid =
    value !== null &&
    Number.isFinite(value) &&
    value >= min * scale &&
    value <= max * scale;
  const confirm = () => {
    if (isValid) onConfirm(value / scale);
  };
  const readout = () => {
    if (!isValid) return "—";
    if (field === "pitch") return noteName(Math.round(value));
    if (field === "duration")
      return formatBeatTime(
        value,
        { numerator: signatureNumerator, denominator: signatureDenominator },
        "length",
      );
    return field === "probability" ? `${String(value)}%` : String(value);
  };
  const noun = count === 1 ? "note" : "notes";
  const label = FIELD_LABEL[field];

  return (
    <Dialog isOpen purpose="form" width={400} onOpenChange={onClose}>
      <Layout
        header={
          <DialogHeader
            title={`Set ${FIELD_LABEL[field]} of ${String(count)} ${noun}`}
            onOpenChange={onClose}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={2}>
              <NumberInput
                label={`${label.charAt(0).toUpperCase()}${label.slice(1)} for every selected note`}
                description={DESCRIPTION[field]}
                size="sm"
                width="100%"
                value={value}
                min={min * scale}
                max={Number.isFinite(max) ? max * scale : undefined}
                step={STEP[field]}
                isIntegerOnly={field !== "duration"}
                hasClear
                hasAutoFocus
                status={
                  isValid
                    ? undefined
                    : { type: "error", message: "Enter a value in range." }
                }
                onChange={setValue}
                onEnter={confirm}
              />
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {readout()}
              </Text>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary" onClick={onClose} />
              <Button
                label="Set"
                variant="primary"
                isDisabled={!isValid}
                onClick={confirm}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
