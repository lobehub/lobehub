'use client';

import { memo } from 'react';

import ExperienceList from '@/features/SelfLearning/ExperienceList';
import SelfLearningSurfaceGate from '@/features/SelfLearning/SurfaceGate';

/** The complete lesson list of one direction — every habit, nothing folded. */
const AgentSelfLearningExperiencePage = memo(() => (
  <SelfLearningSurfaceGate>
    <ExperienceList />
  </SelfLearningSurfaceGate>
));

export default AgentSelfLearningExperiencePage;
