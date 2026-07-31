'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentUsage from '@/features/AgentUsage';

const AgentStatisticsPage = memo(() => (
  <Suspense fallback={<Loading debugId="AgentUsage" />}>
    <AgentUsage />
  </Suspense>
));

export default AgentStatisticsPage;
