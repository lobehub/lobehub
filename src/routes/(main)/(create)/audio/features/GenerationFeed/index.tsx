'use client';

import { Flexbox } from '@lobehub/ui';
import { Empty } from 'antd';
import { memo } from 'react';

import { useAudioStore } from '@/store/audio';
import AudioCard from './AudioCard';

const GenerationFeed = memo(() => {
  const batchesMap = useAudioStore((s) => s.generationBatchesMap);
  const activeTopicId = useAudioStore((s) => s.activeGenerationTopicId);

  const batches = activeTopicId ? batchesMap[activeTopicId] || [] : [];

  if (batches.length === 0) {
    return <Empty description="No audio generated yet" />;
  }

  return (
    <Flexbox gap="md" padding="md">
      {batches.map((batch) =>
        batch.generations.map((generation) => (
          <AudioCard
            key={generation.id}
            batch={batch}
            generation={generation}
          />
        )),
      )}
    </Flexbox>
  );
});

GenerationFeed.displayName = 'AudioGenerationFeed';

export default GenerationFeed;
