'use client';

import { memo } from 'react';

import LessonDetail from '@/features/SelfLearning/LessonDetail';
import SelfLearningSurfaceGate from '@/features/SelfLearning/SurfaceGate';

const AgentSelfLearningLessonPage = memo(() => (
  <SelfLearningSurfaceGate>
    <LessonDetail />
  </SelfLearningSurfaceGate>
));

export default AgentSelfLearningLessonPage;
