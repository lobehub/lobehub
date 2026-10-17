import { router } from '@/libs/trpc/lambda';

import { onboardingProcedures } from './onboarding';
import { onboardingUnderstandingProcedures } from './onboardingUnderstanding';
import { profileProcedures } from './profile';
import { settingsProcedures } from './settings';

export const userRouter = router({
  ...profileProcedures,
  ...onboardingUnderstandingProcedures,
  ...settingsProcedures,
  ...onboardingProcedures,
});

export type UserRouter = typeof userRouter;
