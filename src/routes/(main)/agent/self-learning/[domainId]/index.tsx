'use client';

import { memo } from 'react';

import SelfLearning from '@/features/SelfLearning';
import SelfLearningSurfaceGate from '@/features/SelfLearning/SurfaceGate';

/** The domain page is the same growth portrait, scoped to one direction via :domainId. */
const AgentSelfLearningDomainPage = memo(() => (
  <SelfLearningSurfaceGate>
    <SelfLearning />
  </SelfLearningSurfaceGate>
));

export default AgentSelfLearningDomainPage;
