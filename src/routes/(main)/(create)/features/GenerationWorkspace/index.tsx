'use client';

import type { ComponentType } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';

import type { GenerationWorkspaceContentSelectors } from './Content';
import Content from './Content';
import EmptyState from './EmptyState';

interface GenerationWorkspaceProps {
  /** When false, rendered by the page-level fixed bottom input box, not embedded here (consistent with agent layout) */
  embedInput?: boolean;
  GenerationFeed: ComponentType;
  PromptInput: ComponentType<{ disableAnimation?: boolean; showTitle?: boolean }>;
  selectors: GenerationWorkspaceContentSelectors;
  SkeletonList: ComponentType<{ embedInput?: boolean }>;
  useStore: (selector: (s: any) => any) => any;
}

const GenerationWorkspace = ({
  embedInput = true,
  useStore,
  selectors,
  PromptInput,
  GenerationFeed,
  SkeletonList,
}: GenerationWorkspaceProps) => {
  const [topic] = useQueryState('topic');
  const isCreatingWithNewTopic = useStore((s: any) => s.isCreatingWithNewTopic);

  if (!topic || isCreatingWithNewTopic) {
    return <EmptyState PromptInput={PromptInput} embedInput={embedInput} />;
  }

  return (
    <Content
      EmptyStateComponent={EmptyState}
      GenerationFeed={GenerationFeed}
      PromptInput={PromptInput}
      SkeletonList={SkeletonList}
      embedInput={embedInput}
      selectors={selectors}
      useStore={useStore}
    />
  );
};

export default GenerationWorkspace;
