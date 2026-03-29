'use client';

import { memo } from 'react';
import { Navigate } from 'react-router-dom';

import { DEFAULT_ONBOARDING_PATH } from '@/routes/onboarding/config';

const OnboardingPage = memo(() => {
  return <Navigate replace to={DEFAULT_ONBOARDING_PATH} />;
});

OnboardingPage.displayName = 'OnboardingPage';

export default OnboardingPage;
