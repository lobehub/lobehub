'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentTopicManager from '@/features/AgentTopicManager';

const AgentTopicsPage = memo(() => (
  <Suspense fallback={<Loading debugId="AgentTopicManager" />}>
    <AgentTopicManager />
  </Suspense>
));

export default AgentTopicsPage;
