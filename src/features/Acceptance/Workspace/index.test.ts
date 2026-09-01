import { describe, expect, it } from 'vitest';

import { shouldShowAcceptanceOnboarding } from './index';

describe('shouldShowAcceptanceOnboarding', () => {
  it('uses the full-page onboarding only after the complete list resolves empty', () => {
    expect(shouldShowAcceptanceOnboarding({ data: [], enabled: true, isLoading: false })).toBe(
      true,
    );
    expect(shouldShowAcceptanceOnboarding({ data: [{}], enabled: true, isLoading: false })).toBe(
      false,
    );
    expect(shouldShowAcceptanceOnboarding({ data: [], enabled: true, isLoading: true })).toBe(
      false,
    );
    expect(
      shouldShowAcceptanceOnboarding({
        data: [],
        enabled: true,
        error: new Error('network'),
        isLoading: false,
      }),
    ).toBe(false);
    expect(shouldShowAcceptanceOnboarding({ data: [], enabled: false, isLoading: false })).toBe(
      false,
    );
  });
});
