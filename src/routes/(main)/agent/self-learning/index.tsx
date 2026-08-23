'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import SelfLearning from '@/features/SelfLearning';

const AgentSelfLearningPage = memo(() => (
  <Suspense fallback={<Loading debugId="SelfLearning" />}>
    <SelfLearning />
  </Suspense>
));

export default AgentSelfLearningPage;
