'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import RulesDetail from '@/features/SelfLearning/RulesDetail';

const AgentSelfLearningRulesPage = memo(() => (
  <Suspense fallback={<Loading debugId={'SelfLearningRules'} />}>
    <RulesDetail />
  </Suspense>
));

export default AgentSelfLearningRulesPage;
