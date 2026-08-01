import { describe, expect, it } from 'vitest';

import {
  getFinishedOnboardingBounceTarget,
  shouldDeferOnboardingRedirect,
} from './useUserStateRedirect';

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
    expect(shouldDeferOnboardingRedirect('/verify-phone')).toBe(false);
  });
});

describe('getFinishedOnboardingBounceTarget', () => {
  it('returns null when not on onboarding', () => {
    expect(getFinishedOnboardingBounceTarget('/', '')).toBeNull();
    expect(getFinishedOnboardingBounceTarget('/agent', '')).toBeNull();
  });

  it('bounces finished users from /onboarding to / by default', () => {
    expect(getFinishedOnboardingBounceTarget('/onboarding', '')).toBe('/');
  });

  it('honors a safe callbackUrl query param', () => {
    expect(getFinishedOnboardingBounceTarget('/onboarding', '?callbackUrl=%2Fsettings')).toBe(
      '/settings',
    );
  });

  it('rejects hostile callbackUrl values', () => {
    expect(
      getFinishedOnboardingBounceTarget('/onboarding', '?callbackUrl=https%3A%2F%2Fevil.com'),
    ).toBe('/');
  });
});
