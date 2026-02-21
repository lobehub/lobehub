'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, Suspense } from 'react';

import List from './List';
import Skeleton from './Skeleton';
import { type SuggestMode } from './useRandomQuestions';

interface SuggestQuestionsProps {
  count?: number;
  mode: SuggestMode;
}

const SuggestQuestions = memo<SuggestQuestionsProps>(({ mode, count = 3 }) => {
  return (
    <Flexbox width={'100%'}>
      <Suspense fallback={<Skeleton count={count} />}>
        <List count={count} mode={mode} />
      </Suspense>
    </Flexbox>
  );
});

export default SuggestQuestions;

export { type SuggestMode } from './useRandomQuestions';
