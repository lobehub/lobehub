'use client';

import { Suspense } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentUsage from '@/features/AgentUsage';

const AgentStatisticsPage = () => (
  <Suspense fallback={<SurfaceSkeleton variant={'grid'} />}>
    <AgentUsage />
  </Suspense>
);

export default AgentStatisticsPage;
