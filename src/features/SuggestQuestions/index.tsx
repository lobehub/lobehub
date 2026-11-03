'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, Suspense } from 'react';

import { usePermission } from '@/hooks/usePermission';

import List from './List';
import Skeleton from './Skeleton';
import { type SuggestMode } from './useRandomQuestions';

interface SuggestQuestionsProps {
  count?: number;
  disabled?: boolean;
  mode: SuggestMode;
}

const SuggestQuestions = memo<SuggestQuestionsProps>(({ mode, count = 3, disabled }) => {
  const { allowed: canCreateContent } = usePermission('create_content');
  const isDisabled = disabled || !canCreateContent;

  return (
    <Flexbox width={'100%'}>
      <Suspense fallback={<Skeleton count={count} />}>
        <List count={count} disabled={isDisabled} mode={mode} />
      </Suspense>
    </Flexbox>
  );
});

export default SuggestQuestions;

export { type SuggestMode } from './useRandomQuestions';
