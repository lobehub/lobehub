'use client';

import { memo, Suspense } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentTopicManager from '@/features/AgentTopicManager';

const AgentTopicsPage = memo(() => (
  <Suspense fallback={<SurfaceSkeleton variant={'list'} />}>
    <AgentTopicManager />
  </Suspense>
));

export default AgentTopicsPage;
