import type { Note } from "@/lib/Domain";

import { useEffect, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { useMutation } from "@tanstack/react-query";

import { renderLilyPondSvg } from "@/lib/lilypond/renderServerFn";

interface ScorePanelProps {
  notes: readonly Note[];
}

function ScoreDisplay({ notes }: { notes: readonly Note[] }) {
  const [lilypondSvg, setLilypondSvg] = useState<string | null>(null);
  const { mutate: renderLilypond } = useMutation({
    mutationFn: async (noteData: readonly Note[]) => {
      const response = await renderLilyPondSvg({ data: { notes: noteData } });
      return await response.text();
    },
    onSuccess: setLilypondSvg,
  });

  useEffect(() => {
    if (notes.length === 0) return;
    renderLilypond(notes);
  }, [renderLilypond, notes]);

  if (notes.length === 0) return null;

  return (
    <HStack isScrollable>
      <div dangerouslySetInnerHTML={{ __html: lilypondSvg ?? "" }} />
    </HStack>
  );
}

export function ScorePanel({ notes }: ScorePanelProps) {
  const [renderedNotes, setRenderedNotes] = useState(notes);
  const isStale = renderedNotes !== notes;

  return (
    <Section paddingBlock={2}>
      <VStack gap={2}>
        <Toolbar
          label="Score"
          size="sm"
          startContent={
            <>
              <Text type="label">Score</Text>
              {isStale && (
                <>
                  <StatusDot variant="warning" label="Score is stale" />
                  <Text type="supporting" color="secondary">
                    Unsent edits · refresh to update
                  </Text>
                </>
              )}
            </>
          }
          endContent={
            <Button
              label="Refresh score"
              size="sm"
              isDisabled={!isStale}
              onClick={() => {
                setRenderedNotes(notes);
              }}
            />
          }
        />
        <ScoreDisplay notes={renderedNotes} />
      </VStack>
    </Section>
  );
}
