'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import ExperienceList from '@/features/SelfLearning/ExperienceList';

/** The complete lesson list of one direction — every habit, nothing folded. */
const AgentSelfLearningExperiencePage = memo(() => (
  <Suspense fallback={<Loading debugId={'SelfLearningExperience'} />}>
    <ExperienceList />
  </Suspense>
));

export default AgentSelfLearningExperiencePage;
