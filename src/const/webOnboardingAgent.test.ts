import { DEFAULT_ONBOARDING_MODEL, DEFAULT_ONBOARDING_PROVIDER } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import { WEB_ONBOARDING } from '../../packages/builtin-agents/src/agents/web-onboarding';

describe('WEB_ONBOARDING', () => {
  it('persists with the dedicated onboarding default model and provider', () => {
    expect(WEB_ONBOARDING.persist).toMatchObject({
      model: DEFAULT_ONBOARDING_MODEL,
      provider: DEFAULT_ONBOARDING_PROVIDER,
    });
  });
});
