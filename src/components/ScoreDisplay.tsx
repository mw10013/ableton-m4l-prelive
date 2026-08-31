import type { Note } from "@/lib/Domain";

import { useEffect, useState } from "react";

import { HStack } from "@astryxdesign/core/Stack";
import { useMutation } from "@tanstack/react-query";

import { renderLilyPondSvg } from "@/lib/lilypond/renderServerFn";

interface ScoreDisplayProps {
  notes: readonly Note[];
  renderToken?: number;
}

export function ScoreDisplay({ notes, renderToken }: ScoreDisplayProps) {
  const [lilypondSvg, setLilypondSvg] = useState<string | null>(null);

  const { mutate: renderLilypond } = useMutation({
    mutationFn: async (noteData: readonly Note[]) => {
      const response = await renderLilyPondSvg({ data: { notes: noteData } });
      return await response.text();
    },
    onSuccess: (svg) => {
      setLilypondSvg(svg);
    },
  });

  useEffect(() => {
    if (!renderToken || notes.length === 0) return;
    renderLilypond(notes);
  }, [renderToken, renderLilypond, notes]);

  if (notes.length === 0) return null;

  return (
    <HStack isScrollable>
      <div dangerouslySetInnerHTML={{ __html: lilypondSvg ?? "" }} />
    </HStack>
  );
}
