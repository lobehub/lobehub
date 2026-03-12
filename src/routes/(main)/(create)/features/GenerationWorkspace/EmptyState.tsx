'use client';

import { Center } from '@lobehub/ui';
import type { ComponentType } from 'react';
import { memo } from 'react';

interface EmptyStateProps {
  /** 为 false 时由页面级输入框渲染，此处只显示占位 */
  embedInput?: boolean;
  /** Prompt input component to show when embedInput is true */
  PromptInput: ComponentType<{ disableAnimation?: boolean; showTitle?: boolean }>;
}

const EmptyState = memo<EmptyStateProps>(({ embedInput = true, PromptInput }) => {
  if (!embedInput) {
    return <Center flex={1} />;
  }
  return (
    <Center height={'calc(100vh - 180px)'}>
      <PromptInput showTitle={true} />
    </Center>
  );
});

EmptyState.displayName = 'GenerationWorkspaceEmptyState';

export default EmptyState;
