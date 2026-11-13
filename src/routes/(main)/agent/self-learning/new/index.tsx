'use client';

import { memo } from 'react';

import CreateDomainPage from '@/features/SelfLearning/CreateDomainPage';
import SelfLearningSurfaceGate from '@/features/SelfLearning/SurfaceGate';

const AgentSelfLearningCreatePage = memo(() => (
  <SelfLearningSurfaceGate>
    <CreateDomainPage />
  </SelfLearningSurfaceGate>
));

AgentSelfLearningCreatePage.displayName = 'AgentSelfLearningCreatePage';

export default AgentSelfLearningCreatePage;
