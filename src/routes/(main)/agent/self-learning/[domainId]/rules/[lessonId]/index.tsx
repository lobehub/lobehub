'use client';

import { memo } from 'react';
import { Navigate, useParams } from 'react-router';

/** Legacy `/rules/:lessonId` deep-links land on the renamed `/experience/:lessonId`. */
const LegacyRuleRedirect = memo(() => {
  const { lessonId } = useParams();
  return <Navigate replace to={`../experience/${lessonId}`} />;
});

export default LegacyRuleRedirect;
