'use client';

import { memo } from 'react';

import SelfLearning from '@/features/SelfLearning';
import SelfLearningSurfaceGate from '@/features/SelfLearning/SurfaceGate';

const AgentSelfLearningPage = memo(() => (
  <SelfLearningSurfaceGate>
    <SelfLearning />
  </SelfLearningSurfaceGate>
));

export default AgentSelfLearningPage;
