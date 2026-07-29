import { describe, expect, it } from 'vitest';

import { shouldDeferOnboardingRedirect } from './useUserStateRedirect';

describe('shouldDeferOnboardingRedirect', () => {
  it('defers on invite routes so invited users can accept before onboarding', () => {
    expect(shouldDeferOnboardingRedirect('/invite/abc')).toBe(true);
    expect(shouldDeferOnboardingRedirect('/invite/abc/')).toBe(true);
  });

  it('defers on possible workspace slug routes', () => {
    expect(shouldDeferOnboardingRedirect('/acme')).toBe(true);
    expect(shouldDeferOnboardingRedirect('/acme/settings/members')).toBe(true);
  });

  it('does not defer on personal app routes', () => {
    expect(shouldDeferOnboardingRedirect('/')).toBe(false);
    expect(shouldDeferOnboardingRedirect('/agent')).toBe(false);
    expect(shouldDeferOnboardingRedirect('/settings/profile')).toBe(false);
  });
});
