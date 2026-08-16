'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import SelfLearning from '@/features/SelfLearning';

/** The domain page is the same growth portrait, scoped to one direction via :domainId. */
const AgentSelfLearningDomainPage = memo(() => (
  <Suspense fallback={<Loading debugId="SelfLearningDomain" />}>
    <SelfLearning />
  </Suspense>
));

export default AgentSelfLearningDomainPage;
