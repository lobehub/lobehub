import { cssVar } from 'antd-style';
import { useMemo } from 'react';

import { useVideoStore } from '@/store/video';
import { generationBatchSelectors } from '@/store/video/selectors';
import type { Generation, GenerationBatch, VideoGenerationAsset } from '@/types/generation';

/** Guards against malformed cycles when walking the edit chain. */
const MAX_VERSION_DEPTH = 50;

export interface VideoVersionNode {
  batch: GenerationBatch;
  generation: Generation;
  /** Whether another generation in the topic was edited from this one. */
  hasEdits: boolean;
  /** Source generation id; set only when this generation is an edit. */
  previousGenerationId?: string;
  /** 1 for an original generation, +1 for every edit on top of it. */
  version: number;
}

export const getPreviousGenerationId = (generation: Generation): string | undefined =>
  generation.previousGenerationId ??
  (generation.asset as VideoGenerationAsset | null | undefined)?.previousGenerationId;

/**
 * Indexes the topic's video generations and numbers each edit chain (V1, V2, …).
 * When a source was deleted, the edit keeps counting from the last known version.
 */
export const buildVideoVersionMap = (batches: GenerationBatch[]) => {
  const byId = new Map<string, { batch: GenerationBatch; generation: Generation }>();

  for (const batch of batches) {
    for (const generation of batch.generations) byId.set(generation.id, { batch, generation });
  }

  const versions = new Map<string, VideoVersionNode>();

  for (const [id, entry] of byId) {
    let version = 1;
    let cursor = getPreviousGenerationId(entry.generation);

    while (cursor && version < MAX_VERSION_DEPTH) {
      version += 1;
      const source = byId.get(cursor);
      cursor = source ? getPreviousGenerationId(source.generation) : undefined;
    }

    versions.set(id, {
      ...entry,
      hasEdits: false,
      previousGenerationId: getPreviousGenerationId(entry.generation),
      version,
    });
  }

  for (const node of versions.values()) {
    const source = node.previousGenerationId ? versions.get(node.previousGenerationId) : undefined;
    if (source) source.hasEdits = true;
  }

  return versions;
};

export const useVideoVersionMap = () => {
  const batches = useVideoStore(generationBatchSelectors.currentGenerationBatches);

  return useMemo(() => buildVideoVersionMap(batches ?? []), [batches]);
};

const generationSelector = (generationId: string) =>
  `[data-video-generation-id="${CSS.escape(generationId)}"]`;

/**
 * Brings a generation card into view and briefly outlines it, so users can find
 * the version an edit came from in a long feed.
 */
export const revealVideoGeneration = (generationId: string) => {
  const element = document.querySelector<HTMLElement>(generationSelector(generationId));
  if (!element) return;

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.animate(
    [{ boxShadow: `0 0 0 2px ${cssVar.colorPrimary}` }, { boxShadow: '0 0 0 2px transparent' }],
    { delay: 300, duration: 1600, easing: 'ease-out' },
  );
};
