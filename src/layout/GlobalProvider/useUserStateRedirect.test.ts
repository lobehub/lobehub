import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type UserInitializationState } from '@/types/user';

import {
  getOnboardingRedirectUrl,
  shouldDeferOnboardingRedirect,
  useUserStateRedirect,
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
    expect(shouldDeferOnboardingRedirect('/projects')).toBe(false);
    expect(shouldDeferOnboardingRedirect('/settings/profile')).toBe(false);
    expect(shouldDeferOnboardingRedirect('/verify-im')).toBe(false);
  });
});

describe('useUserStateRedirect on Web', () => {
  const originalLocation = window.location;

  const openPage = (url: string) => {
    const { pathname, search } = new URL(url, 'https://app.example.com');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: url, pathname, search },
    });
  };

  const notOnboarded = { onboarding: { currentStep: 1, version: 1 } } as UserInitializationState;
  const onboarded = {
    onboarding: { currentStep: 1, finishedAt: '2026-01-01T00:00:00.000Z', version: 1 },
  } as UserInitializationState;

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('sends an un-onboarded user who opens an IM binding link to onboarding and back', () => {
    const bindingLink = '/verify-im?random_id=abcdefgh&im_type=telegram';
    openPage(bindingLink);

    const { result } = renderHook(() => useUserStateRedirect());
    result.current(notOnboarded);

    expect(window.location.href).toBe(`/onboarding?callbackUrl=${encodeURIComponent(bindingLink)}`);
  });

  it('lets an onboarded user stay on the IM binding page', () => {
    const bindingLink = '/verify-im?random_id=abcdefgh&im_type=telegram';
    openPage(bindingLink);

    const { result } = renderHook(() => useUserStateRedirect());
    result.current(onboarded);

    expect(window.location.href).toBe(bindingLink);
  });

  it('still lets an un-onboarded user accept a workspace invite first', () => {
    openPage('/invite/abc');

    const { result } = renderHook(() => useUserStateRedirect());
    result.current(notOnboarded);

    expect(window.location.href).toBe('/invite/abc');
  });
});

describe('getOnboardingRedirectUrl', () => {
  const unfinished = { onboarding: { currentStep: 2, version: 1 } };
  const finished = { onboarding: { currentStep: 5, finishedAt: '2026-10-01', version: 1 } };

  it('sends a Desktop user whose account onboarding is unfinished to /onboarding', () => {
    // Started onboarding on Web, closed the tab, then signed in through Desktop:
    // the main window must not open until account onboarding finishes.
    expect(
      getOnboardingRedirectUrl({
        isDesktopRuntime: true,
        pathname: '/',
        search: '',
        state: unfinished,
      }),
    ).toBe('/onboarding');
  });

  it('keeps the Desktop page the user was opening as the post-onboarding target', () => {
    expect(
      getOnboardingRedirectUrl({
        isDesktopRuntime: true,
        pathname: '/agent/inbox',
        search: '?topic=1',
        state: unfinished,
      }),
    ).toBe(`/onboarding?callbackUrl=${encodeURIComponent('/agent/inbox?topic=1')}`);
  });

  it('lets Desktop local first-run setup finish before account onboarding', () => {
    expect(
      getOnboardingRedirectUrl({
        isDesktopRuntime: true,
        pathname: '/desktop-onboarding',
        search: '?screen=login',
        state: unfinished,
      }),
    ).toBeUndefined();
  });

  it('opens the Desktop main window once account onboarding is finished', () => {
    expect(
      getOnboardingRedirectUrl({
        isDesktopRuntime: true,
        pathname: '/',
        search: '',
        state: finished,
      }),
    ).toBeUndefined();
  });

  it('keeps the existing Web redirect', () => {
    expect(
      getOnboardingRedirectUrl({ isDesktopRuntime: false, pathname: '/', search: '', state: {} }),
    ).toBe('/onboarding');
    expect(
      getOnboardingRedirectUrl({
        isDesktopRuntime: false,
        pathname: '/onboarding',
        search: '',
        state: unfinished,
      }),
    ).toBeUndefined();
  });
});
