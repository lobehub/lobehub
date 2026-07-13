'use client';

import { Center } from '@lobehub/ui';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import type { GenerationBatch, ImageGenerationTopic } from '@/types/generation';

export interface GenerationWorkspaceContentSelectors {
  activeGenerationTopicId: (s: any) => string | null | undefined;
  currentGenerationBatches: (s: any) => GenerationBatch[] | null;
  generationTopics: (s: any) => ImageGenerationTopic[];
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
  const { t } = useTranslation('image');
  const activeTopicId = useStore(selectors.activeGenerationTopicId);
  const useFetchGenerationBatches = useStore((s: any) => s.useFetchGenerationBatches);
  const useFetchGenerationTopics = useStore((s: any) => s.useFetchGenerationTopics);
  const isCurrentGenerationTopicLoaded = useStore(selectors.isCurrentGenerationTopicLoaded);
  // Keep `error` / `mutate`: the topic's "loaded" flag is `Array.isArray(map[topicId])`,
  // written only on success, so a failed batch fetch would otherwise stick on the
  // skeleton forever with no retry.
  const { error, mutate } = useFetchGenerationBatches(activeTopicId);
  // Same SWR key the topic panel uses — `data !== undefined` marks the list as
  // loaded at least once, so an absent topic is a settled fact, not a race.
  const { data: loadedTopics } = useFetchGenerationTopics(true);
  const topics = useStore(selectors.generationTopics);
  const currentBatches = useStore(selectors.currentGenerationBatches);
  const hasGenerations = currentBatches && currentBatches.length > 0;

  // The routed topic is absent from the ownership-scoped list — it was deleted
  // or the viewer lost access (e.g. switched back to private by its owner).
  // Membership is checked against the STORE list (updated optimistically on
  // create) so a just-created topic never flashes the 404 card. A later
  // successful revalidation that re-includes the topic clears this branch.
  const isTopicMissing =
    !!activeTopicId &&
    loadedTopics !== undefined &&
    !topics.some((topic: ImageGenerationTopic) => topic.id === activeTopicId);

  if (isTopicMissing) {
    return (
      <Center flex={1} padding={24} width={'100%'}>
        <NotFound
          desc={t('generationTopic.notFound.desc')}
          title={t('generationTopic.notFound.title')}
        />
      </Center>
    );
  }

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
