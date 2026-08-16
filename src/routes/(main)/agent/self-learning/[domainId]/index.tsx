'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import DomainDetail from '@/features/SelfLearning/Detail';

const AgentSelfLearningDomainPage = memo(() => (
  <Suspense fallback={<Loading debugId="SelfLearningDomain" />}>
    <DomainDetail />
  </Suspense>
));

export default AgentSelfLearningDomainPage;
