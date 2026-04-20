import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import { describe, expect, it } from 'vitest';

import { getApiNamesForIdentifier, hasExecutor } from './index';

describe('builtin executor registry', () => {
  it('registers web onboarding executor APIs', () => {
    expect(hasExecutor(WebOnboardingIdentifier, WebOnboardingApiName.getOnboardingState)).toBe(
      true,
    );
    expect(hasExecutor(WebOnboardingIdentifier, WebOnboardingApiName.saveUserQuestion)).toBe(true);
    expect(hasExecutor(WebOnboardingIdentifier, WebOnboardingApiName.finishOnboarding)).toBe(true);
    expect(getApiNamesForIdentifier(WebOnboardingIdentifier)).toEqual(
      Object.values(WebOnboardingApiName),
    );
  });
});
