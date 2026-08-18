'use client';

import { Suspense } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentTopicManager from '@/features/AgentTopicManager';

const AgentTopicsPage = () => (
  <Suspense fallback={<SurfaceSkeleton variant={'list'} />}>
    <AgentTopicManager />
  </Suspense>
);

export default AgentTopicsPage;
