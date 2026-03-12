'use client';

import type { ComponentType } from 'react';

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
  useFetchGenerationBatches(activeTopicId);
  const currentBatches = useStore(selectors.currentGenerationBatches);
  const hasGenerations = currentBatches && currentBatches.length > 0;

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
