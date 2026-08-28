'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import CreateDomainPage from '@/features/SelfLearning/CreateDomainPage';

const AgentSelfLearningCreatePage = memo(() => (
  <Suspense fallback={<Loading debugId="SelfLearningCreate" />}>
    <CreateDomainPage />
  </Suspense>
));

AgentSelfLearningCreatePage.displayName = 'AgentSelfLearningCreatePage';

export default AgentSelfLearningCreatePage;
