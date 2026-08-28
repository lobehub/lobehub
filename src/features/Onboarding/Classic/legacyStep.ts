import { CLASSIC_ONBOARDING_MAX_STEP } from '@lobechat/types';

export const remapLegacyClassicStep = (raw: number): number => {
  if (raw <= 2) return 1;
  if (raw === 3) return 2;
  return CLASSIC_ONBOARDING_MAX_STEP - 1;
};

export const isLegacyClassicStep = (raw: number): boolean => raw > CLASSIC_ONBOARDING_MAX_STEP;
