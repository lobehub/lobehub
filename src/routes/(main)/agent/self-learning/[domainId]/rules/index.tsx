'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import SelfLearning from '@/features/SelfLearning';

/** Kept for deep links: the habit list now lives on the domain portrait itself. */
const AgentSelfLearningRulesPage = memo(() => (
  <Suspense fallback={<Loading debugId={'SelfLearningRules'} />}>
    <SelfLearning />
  </Suspense>
));

export default AgentSelfLearningRulesPage;
