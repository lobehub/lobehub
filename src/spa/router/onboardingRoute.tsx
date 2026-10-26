import type { RouteObject } from 'react-router';

import { dynamicElement, dynamicLayout, ErrorBoundary } from '@/utils/router';

/**
 * Account onboarding (`users.onboarding`), shared by Web and Electron.
 * Electron enters it after its local `/desktop-onboarding` setup when the
 * signed-in account has not finished it.
 */
export const onboardingRoute: RouteObject = {
  children: [
    {
      element: dynamicElement(() => import('@/routes/onboarding'), 'Desktop > Onboarding'),
      index: true,
    },
  ],
  element: dynamicLayout(
    () => import('@/routes/onboarding/_layout'),
    'Desktop > Onboarding > Layout',
  ),
  errorElement: <ErrorBoundary />,
  path: '/onboarding',
};
