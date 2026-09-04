'use client';

import { memo } from 'react';
import { Navigate } from 'react-router';

import { useParams } from '@/libs/router/navigation';

/** Legacy `/rules/:lessonId` deep-links land on the renamed `/experience/:lessonId`. */
const LegacyRuleRedirect = memo(() => {
  const { lessonId } = useParams('lessonId');
  return <Navigate replace to={`../experience/${lessonId}`} />;
});

export default LegacyRuleRedirect;
