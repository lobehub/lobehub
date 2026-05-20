import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import { describe, expect, it } from 'vitest';

import { shouldRenderToolCall } from './toolRenderRules';

describe('shouldRenderToolCall', () => {
  it('hides the onboarding completion tool call', () => {
    expect(
      shouldRenderToolCall({
        apiName: WebOnboardingApiName.finishOnboarding,
        identifier: WebOnboardingIdentifier,
      }),
    ).toBe(false);
  });

  it('keeps other onboarding tool calls visible', () => {
    expect(
      shouldRenderToolCall({
        apiName: WebOnboardingApiName.saveUserQuestion,
        identifier: WebOnboardingIdentifier,
      }),
    ).toBe(true);
  });

  it('keeps non-onboarding tool calls visible', () => {
    expect(
      shouldRenderToolCall({
        apiName: 'search',
        identifier: 'lobe-web-browsing',
      }),
    ).toBe(true);
  });
});
