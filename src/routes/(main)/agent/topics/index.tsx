'use client';

import { Suspense } from 'react';

import TopicsSkeleton from '@/components/Skeleton/Topics';
import AgentTopicManager from '@/features/AgentTopicManager';

const AgentTopicsPage = () => (
  <Suspense fallback={<TopicsSkeleton />}>
    <AgentTopicManager />
  </Suspense>
);

export default AgentTopicsPage;
