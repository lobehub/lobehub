import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_ONBOARDING_MODEL } from '@lobechat/const';

export const ONBOARDING_PRODUCTION_DEFAULT_MODEL = {
  model: DEFAULT_ONBOARDING_MODEL,
  provider: DEFAULT_PROVIDER,
} as const;
