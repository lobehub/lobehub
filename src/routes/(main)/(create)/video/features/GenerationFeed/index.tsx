'use client';

import { memo } from 'react';

import GenerationFeed from '@/routes/(main)/(create)/features/GenerationFeed';
import { useVideoStore } from '@/store/video';
import { generationBatchSelectors } from '@/store/video/selectors';

import { VideoGenerationBatchItem } from './BatchItem';

const VideoGenerationFeed = memo(() => {
  const currentGenerationBatches = useVideoStore(generationBatchSelectors.currentGenerationBatches);

  return (
    <GenerationFeed
      batches={currentGenerationBatches ?? []}
      renderBatchItem={(batch) => <VideoGenerationBatchItem batch={batch} key={batch.id} />}
    />
  );
});

VideoGenerationFeed.displayName = 'VideoGenerationFeed';

export default VideoGenerationFeed;
