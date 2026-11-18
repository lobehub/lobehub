'use client';

import { memo } from 'react';

import GenerationFeed from '@/routes/(main)/(create)/features/GenerationFeed';
import { useMusicStore } from '@/store/music';
import { generationBatchSelectors } from '@/store/music/selectors';

import { MusicGenerationBatchItem } from './BatchItem';

const MusicGenerationFeed = memo(() => {
  const currentGenerationBatches = useMusicStore(generationBatchSelectors.currentGenerationBatches);

  return (
    <GenerationFeed
      batches={currentGenerationBatches ?? []}
      renderBatchItem={(batch) => <MusicGenerationBatchItem batch={batch} key={batch.id} />}
    />
  );
});

MusicGenerationFeed.displayName = 'MusicGenerationFeed';

export default MusicGenerationFeed;
