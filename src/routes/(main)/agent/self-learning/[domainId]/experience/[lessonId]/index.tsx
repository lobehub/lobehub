'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import LessonDetail from '@/features/SelfLearning/LessonDetail';

const AgentSelfLearningLessonPage = memo(() => (
  <Suspense fallback={<Loading debugId={'SelfLearningLesson'} />}>
    <LessonDetail />
  </Suspense>
));

export default AgentSelfLearningLessonPage;
