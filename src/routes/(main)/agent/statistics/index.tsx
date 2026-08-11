'use client';

import { memo, Suspense } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentUsage from '@/features/AgentUsage';

const AgentStatisticsPage = memo(() => (
  <Suspense fallback={<SurfaceSkeleton variant={'grid'} />}>
    <AgentUsage />
  </Suspense>
));

export default AgentStatisticsPage;
