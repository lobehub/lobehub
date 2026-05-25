'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentTopics from '@/features/AgentTopics';

const AgentTopicsPage = memo(() => (
  <Suspense fallback={<Loading debugId="AgentTopics" />}>
    <AgentTopics />
  </Suspense>
));

export default AgentTopicsPage;
