import { DEFAULT_ONBOARDING_MODEL, DEFAULT_ONBOARDING_PROVIDER } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import { ONBOARDING_PRODUCTION_DEFAULT_MODEL } from './onboarding';

describe('ONBOARDING_PRODUCTION_DEFAULT_MODEL', () => {
  it('uses the dedicated onboarding default model and provider', () => {
    expect(ONBOARDING_PRODUCTION_DEFAULT_MODEL).toEqual({
      model: DEFAULT_ONBOARDING_MODEL,
      provider: DEFAULT_ONBOARDING_PROVIDER,
    });
  });
});
