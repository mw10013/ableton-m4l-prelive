import type { Note } from "@/lib/Domain";

import { useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

import { positionLabel } from "@/components/NoteTable";
import {
  defaultDestination,
  duplicateNotes,
  isSameRegion,
  quartersPerBar,
  requiredPlaybackRegion,
} from "@/lib/noteEdits";

interface DuplicateNotesDialogProps {
  notes: readonly Note[];
  selected: readonly Note[];
  signatureNumerator: number;
  signatureDenominator: number;
  playback: { readonly start: number; readonly end: number };
  onClose: () => void;
  onConfirm: (destination: number) => void;
}

export function DuplicateNotesDialog({
  notes,
  selected,
  signatureNumerator,
  signatureDenominator,
  playback,
  onClose,
  onConfirm,
}: DuplicateNotesDialogProps) {
  const [destination, setDestination] = useState<number | null>(
    defaultDestination(selected),
  );
  const isValid =
    destination !== null && Number.isFinite(destination) && destination >= 0;
  const bar = quartersPerBar(signatureNumerator, signatureDenominator);
  const region = isValid
    ? requiredPlaybackRegion({
        notes: duplicateNotes({ notes, selected, destination }).notes,
        region: playback,
        quartersPerBar: bar,
      })
    : playback;
  const confirm = () => {
    if (isValid) onConfirm(destination);
  };

  return (
    <Dialog isOpen purpose="form" width={440} onOpenChange={onClose}>
      <Layout
        header={<DialogHeader title="Duplicate notes" onOpenChange={onClose} />}
        content={
          <LayoutContent>
            <VStack gap={2}>
              <NumberInput
                label={`Destination for ${String(selected.length)} ${selected.length === 1 ? "note" : "notes"}`}
                description="Start of the earliest copy, in quarter notes from clip time zero."
                size="sm"
                width="100%"
                value={destination}
                min={0}
                step={0.25}
                hasClear
                hasAutoFocus
                status={
                  isValid
                    ? undefined
                    : {
                        type: "error",
                        message: "Enter a position of 0 or more.",
                      }
                }
                onChange={setDestination}
                onEnter={confirm}
              />
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {isValid
                  ? positionLabel(
                      destination,
                      signatureNumerator,
                      signatureDenominator,
                    )
                  : "—"}
                {!isSameRegion(region, playback) &&
                  ` · clip extends to ${String(Math.round(region.end / bar))} bars on write`}
              </Text>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary" onClick={onClose} />
              <Button
                label="Duplicate"
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
