'use client';

import { useCallback } from 'react';

import { isDesktop } from '@/const/version';
import { onboardingSelectors } from '@/store/user/selectors';
import { type UserInitializationState } from '@/types/user';
import {
  buildOnboardingRedirectUrl,
  peekOnboardingCallbackUrl,
  sanitizeRedirectPath,
} from '@/utils/onboardingRedirect';

const DEFER_REDIRECT_PREFIXES = ['/invite'];

const RESERVED_FIRST_SEGMENTS = new Set([
  'agent',
  'community',
  'desktop-onboarding',
  'devtools',
  'eval',
  'group',
  'image',
  'me',
  'memory',
  'next-auth',
  'onboarding',
  'page',
  'resource',
  'settings',
  'share',
  'signin',
  'signup',
  'subscription',
  'task',
  'tasks',
  'verify-phone',
  'org',
  'invite',
  'wallet',
  'video',
]);

const FIRST_SEGMENT_REGEX = /^\/([^/?#]+)/;

const isPathUnder = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const parseFirstSegment = (pathname: string): string | null => {
  const match = pathname.match(FIRST_SEGMENT_REGEX);
  return match ? match[1] : null;
};

/**
 * Defer the onboarding redirect when the path is a workspace-scoped route
 * (first segment is a workspace slug, i.e. not one of the reserved app
 * segments) or an explicitly deferred prefix like `/invite`. Reserved
 * first segments (e.g. `/agent`, `/settings`) fall through to the normal
 * onboarding check.
 */
export const shouldDeferOnboardingRedirect = (pathname: string): boolean => {
  if (DEFER_REDIRECT_PREFIXES.some((prefix) => isPathUnder(pathname, prefix))) return true;

  const first = parseFirstSegment(pathname);

  return !!first && !RESERVED_FIRST_SEGMENTS.has(first);
};

const redirectToOnboarding = (currentPath: string, search: string) => {
  if (!currentPath.startsWith('/onboarding')) {
    // Thread the page the user was on so onboarding finish points return there
    window.location.href = buildOnboardingRedirectUrl(currentPath + search);
  }
};

/** Where finished users should leave `/onboarding` (null = stay put). */
export const getFinishedOnboardingBounceTarget = (
  pathname: string,
  search: string,
): string | null => {
  if (!pathname.startsWith('/onboarding')) return null;
  const fromQuery = new URLSearchParams(search).get('callbackUrl');
  return sanitizeRedirectPath(fromQuery || peekOnboardingCallbackUrl(), '/');
};

export const useDesktopUserStateRedirect = () => {
  // Desktop onboarding redirect is now handled by main process (BrowserManager)
  // No need to check localStorage here
  return useCallback(() => {}, []);
};

export const useWebUserStateRedirect = () =>
  useCallback((state: UserInitializationState) => {
    const { pathname, search } = window.location;

    // Phone verify is NOT a login gate — only required when claiming trial credits.
    // Call sites should send users to `/verify-phone` at that moment.

    if (onboardingSelectors.needsOnboarding(state)) {
      if (shouldDeferOnboardingRedirect(pathname)) return;
      redirectToOnboarding(pathname, search);
      return;
    }

    // Phone OTP (and similar flows) always target `/onboarding` for new-user
    // safety. Finished users who land there should continue to their destination
    // instead of re-entering the flow.
    const bounceTarget = getFinishedOnboardingBounceTarget(pathname, search);
    if (bounceTarget) window.location.replace(bounceTarget);
  }, []);

export const useUserStateRedirect = () => {
  const desktopRedirect = useDesktopUserStateRedirect();
  const webRedirect = useWebUserStateRedirect();

  return useCallback(
    (state: UserInitializationState) => {
      const redirect = isDesktop ? desktopRedirect : webRedirect;
      redirect(state);
    },
    [desktopRedirect, webRedirect],
  );
};
