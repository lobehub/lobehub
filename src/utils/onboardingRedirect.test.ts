import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildOnboardingRedirectUrl,
  clearStaleOnboardingCallbackUrl,
  consumeOnboardingCallbackUrl,
  isSafeRedirectPath,
  peekOnboardingCallbackUrl,
  stashOnboardingCallbackUrl,
} from './onboardingRedirect';

beforeEach(() => {
  sessionStorage.clear();
});

describe('isSafeRedirectPath', () => {
  it('should accept same-site relative paths', () => {
    expect(isSafeRedirectPath('/')).toBe(true);
    expect(isSafeRedirectPath('/agent/abc?message=hi')).toBe(true);
  });

  it('should reject absolute and protocol-relative URLs', () => {
    expect(isSafeRedirectPath('https://evil.com')).toBe(false);
    expect(isSafeRedirectPath('//evil.com')).toBe(false);
    expect(isSafeRedirectPath('javascript:alert(1)')).toBe(false);
  });

  it('should reject backslash paths that browsers normalize to protocol-relative URLs', () => {
    expect(isSafeRedirectPath('/\\evil.com')).toBe(false);
    expect(isSafeRedirectPath('/\\/evil.com')).toBe(false);
    expect(isSafeRedirectPath('/foo\\bar')).toBe(false);
  });
});

describe('buildOnboardingRedirectUrl', () => {
  it('should return plain onboarding path for default or missing callbackUrl', () => {
    expect(buildOnboardingRedirectUrl()).toBe('/onboarding');
    expect(buildOnboardingRedirectUrl(null)).toBe('/onboarding');
    expect(buildOnboardingRedirectUrl('/')).toBe('/onboarding');
  });

  it('should thread an explicit target through the callbackUrl query param', () => {
    expect(buildOnboardingRedirectUrl('/agent/abc?message=hi')).toBe(
      '/onboarding?callbackUrl=%2Fagent%2Fabc%3Fmessage%3Dhi',
    );
  });

  it('should not nest when the target is already an onboarding path', () => {
    expect(buildOnboardingRedirectUrl('/onboarding')).toBe('/onboarding');
    expect(buildOnboardingRedirectUrl('/onboarding/agent')).toBe('/onboarding/agent');
  });

  it('should drop unsafe external targets', () => {
    expect(buildOnboardingRedirectUrl('https://evil.com')).toBe('/onboarding');
    expect(buildOnboardingRedirectUrl('//evil.com')).toBe('/onboarding');
    expect(buildOnboardingRedirectUrl('/\\evil.com')).toBe('/onboarding');
  });

  it('should normalize same-origin absolute URLs to relative paths', () => {
    const origin = window.location.origin;
    expect(buildOnboardingRedirectUrl(`${origin}/settings?tab=profile`)).toBe(
      '/onboarding?callbackUrl=%2Fsettings%3Ftab%3Dprofile',
    );
    expect(buildOnboardingRedirectUrl(`${origin}/`)).toBe('/onboarding');
    expect(buildOnboardingRedirectUrl(`${origin}/onboarding/agent`)).toBe('/onboarding/agent');
  });
});

describe('stash/peek/consumeOnboardingCallbackUrl', () => {
  it('should stash the callbackUrl from a location search string', () => {
    stashOnboardingCallbackUrl('?callbackUrl=%2Fagent%2Fabc%3Fmessage%3Dhi');

    expect(peekOnboardingCallbackUrl()).toBe('/agent/abc?message=hi');
  });

  it('should keep the stashed value across peeks and clear it on consume', () => {
    stashOnboardingCallbackUrl('?callbackUrl=%2Fdiscover');

    expect(peekOnboardingCallbackUrl()).toBe('/discover');
    expect(consumeOnboardingCallbackUrl()).toBe('/discover');
    expect(peekOnboardingCallbackUrl()).toBeUndefined();
    expect(consumeOnboardingCallbackUrl()).toBeUndefined();
  });

  it('should not stash when callbackUrl is missing or unsafe', () => {
    stashOnboardingCallbackUrl('?step=2');
    expect(peekOnboardingCallbackUrl()).toBeUndefined();

    stashOnboardingCallbackUrl(`?callbackUrl=${encodeURIComponent('https://evil.com')}`);
    expect(peekOnboardingCallbackUrl()).toBeUndefined();
  });

  it('should not clobber an existing stash with internal navigations', () => {
    stashOnboardingCallbackUrl('?callbackUrl=%2Fdiscover');
    stashOnboardingCallbackUrl('?entry=skip');

    expect(peekOnboardingCallbackUrl()).toBe('/discover');
  });
});

describe('clearStaleOnboardingCallbackUrl', () => {
  beforeEach(() => {
    stashOnboardingCallbackUrl('?callbackUrl=%2Fdiscover');
  });

  it('should clear a stale stash on a fresh top-level entry without callbackUrl', () => {
    clearStaleOnboardingCallbackUrl('/onboarding', '');

    expect(peekOnboardingCallbackUrl()).toBeUndefined();
  });

  it('should clear when the supplied callbackUrl is unsafe', () => {
    clearStaleOnboardingCallbackUrl(
      '/onboarding',
      `?callbackUrl=${encodeURIComponent('https://evil.com')}`,
    );

    expect(peekOnboardingCallbackUrl()).toBeUndefined();
  });

  it('should keep the stash when a valid callbackUrl is present', () => {
    clearStaleOnboardingCallbackUrl('/onboarding', '?callbackUrl=%2Fsettings');

    expect(peekOnboardingCallbackUrl()).toBe('/discover');
  });

  it('should keep the stash on shared-prefix re-entries carrying a step param', () => {
    clearStaleOnboardingCallbackUrl('/onboarding', '?step=1');

    expect(peekOnboardingCallbackUrl()).toBe('/discover');
  });

  it('should keep the stash on branch paths', () => {
    clearStaleOnboardingCallbackUrl('/onboarding/agent', '');
    clearStaleOnboardingCallbackUrl('/onboarding/classic', '?entry=skip');

    expect(peekOnboardingCallbackUrl()).toBe('/discover');
  });
});
