'use client';

import { memo } from 'react';

import GenerationFeed from '@/routes/(main)/(create)/features/GenerationFeed';
import { useImageStore } from '@/store/image';
import { generationBatchSelectors } from '@/store/image/selectors';

import { GenerationBatchItem } from './BatchItem';

const ImageGenerationFeed = memo(() => {
  const currentGenerationBatches = useImageStore(generationBatchSelectors.currentGenerationBatches);

  return (
    <GenerationFeed
      batches={currentGenerationBatches ?? []}
      renderBatchItem={(batch) => <GenerationBatchItem batch={batch} key={batch.id} />}
    />
  );
});

ImageGenerationFeed.displayName = 'ImageGenerationFeed';

export default ImageGenerationFeed;
