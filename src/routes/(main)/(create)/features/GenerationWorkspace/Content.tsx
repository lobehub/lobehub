'use client';

import { Center } from '@lobehub/ui';
import type { ComponentType } from 'react';

import AsyncError from '@/components/AsyncError';
import type { GenerationBatch } from '@/types/generation';

export interface GenerationWorkspaceContentSelectors {
  activeGenerationTopicId: (s: any) => string | null | undefined;
  currentGenerationBatches: (s: any) => GenerationBatch[] | null;
  isCurrentGenerationTopicLoaded: (s: any) => boolean;
}

interface GenerationWorkspaceContentProps {
  embedInput?: boolean;
  EmptyStateComponent: ComponentType<{ embedInput?: boolean; PromptInput: ComponentType }>;
  GenerationFeed: ComponentType;
  PromptInput: ComponentType<{ disableAnimation?: boolean; showTitle?: boolean }>;
  selectors: GenerationWorkspaceContentSelectors;
  SkeletonList: ComponentType<{ embedInput?: boolean }>;
  useStore: (selector: (s: any) => any) => any;
}

const Content = ({
  embedInput = true,
  useStore,
  selectors,
  PromptInput,
  GenerationFeed,
  SkeletonList,
  EmptyStateComponent,
}: GenerationWorkspaceContentProps) => {
  const activeTopicId = useStore(selectors.activeGenerationTopicId);
  const useFetchGenerationBatches = useStore((s: any) => s.useFetchGenerationBatches);
  const isCurrentGenerationTopicLoaded = useStore(selectors.isCurrentGenerationTopicLoaded);
  // Keep `error` / `mutate`: the topic's "loaded" flag is `Array.isArray(map[topicId])`,
  // written only on success, so a failed batch fetch would otherwise stick on the
  // skeleton forever with no retry (LOBE-11208).
  const { error, mutate } = useFetchGenerationBatches(activeTopicId);
  const currentBatches = useStore(selectors.currentGenerationBatches);
  const hasGenerations = currentBatches && currentBatches.length > 0;

  // Error gated ahead of the skeleton (loaded flag stays false on failure).
  if (error && !isCurrentGenerationTopicLoaded) {
    return (
      <Center flex={1} padding={24} width={'100%'}>
        <AsyncError error={error} variant={'block'} onRetry={() => mutate()} />
      </Center>
    );
  }

  if (!isCurrentGenerationTopicLoaded) {
    return <SkeletonList embedInput={embedInput} />;
  }

  if (!hasGenerations) {
    return <EmptyStateComponent PromptInput={PromptInput} embedInput={embedInput} />;
  }

  return (
    <>
      <GenerationFeed key={activeTopicId} />
      {embedInput && <PromptInput disableAnimation showTitle={false} />}
    </>
  );
};

export default Content;
