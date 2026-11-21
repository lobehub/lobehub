import { mergeRouters } from '@/libs/trpc/lambda';

import { onboardingRouter } from './onboarding';
import { onboardingUnderstandingRouter } from './onboardingUnderstanding';
import { profileRouter } from './profile';
import { settingsRouter } from './settings';

export const userRouter = mergeRouters(
  profileRouter,
  onboardingUnderstandingRouter,
  settingsRouter,
  onboardingRouter,
);

export type UserRouter = typeof userRouter;
