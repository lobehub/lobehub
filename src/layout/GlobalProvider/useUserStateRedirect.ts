'use client';

import { useCallback } from 'react';

import { isDesktop } from '@/const/version';
import { onboardingSelectors } from '@/store/user/selectors';
import { type UserInitializationState } from '@/types/user';
import { buildOnboardingRedirectUrl } from '@/utils/onboardingRedirect';

const DEFER_REDIRECT_PREFIXES = ['/invite'];

// `/a/:slugOrId` (agent-share visitor page) is deliberately NOT listed: a
// user who followed a share link should reach the shared agent, not be
// bounced into onboarding first.
// `verify-im` must stay listed: binding an IM account lets that platform start
// agent runs, which an un-onboarded account cannot use, so the binding link
// detours through onboarding and returns via `callbackUrl`.
const RESERVED_FIRST_SEGMENTS = new Set([
  'agent',
  'apps',
  'community',
  'desktop-onboarding',
  'devtools',
  'eval',
  'goal',
  'goals',
  'group',
  'image',
  'me',
  'memory',
  'next-auth',
  'onboarding',
  'page',
  'projects',
  'resource',
  'settings',
  'share',
  'signin',
  'signup',
  'subscription',
  'task',
  'tasks',
  'verify-im',
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

/**
 * Desktop's local first-run setup (welcome, login, permissions, data mode).
 * It runs before the account-level onboarding below and must not be
 * interrupted once its login step fetches the user state.
 */
const DESKTOP_LOCAL_SETUP_PATH = '/desktop-onboarding';

interface OnboardingRedirectInput {
  isDesktopRuntime: boolean;
  pathname: string;
  search: string;
  state: Pick<UserInitializationState, 'onboarding'>;
}

/**
 * Resolve where a user who has not finished account onboarding
 * (`users.onboarding.finishedAt`) must go, or `undefined` to stay.
 *
 * Desktop applies the same account check as Web: its local setup
 * (`desktopOnboardingCompleted` in the main process) only covers the device,
 * so an account that signed in through the Desktop OIDC flow still has to
 * finish `/onboarding` before using the main window.
 */
export const getOnboardingRedirectUrl = ({
  isDesktopRuntime,
  pathname,
  search,
  state,
}: OnboardingRedirectInput): string | undefined => {
  if (!onboardingSelectors.needsOnboarding(state)) return;
  if (pathname.startsWith('/onboarding')) return;
  if (isDesktopRuntime && isPathUnder(pathname, DESKTOP_LOCAL_SETUP_PATH)) return;
  if (shouldDeferOnboardingRedirect(pathname)) return;

  // Thread the page the user was on so onboarding finish points return there
  return buildOnboardingRedirectUrl(pathname + search);
};

export const useUserStateRedirect = () =>
  useCallback((state: UserInitializationState) => {
    const { pathname, search } = window.location;
    const redirectUrl = getOnboardingRedirectUrl({
      isDesktopRuntime: isDesktop,
      pathname,
      search,
      state,
    });

    if (redirectUrl) window.location.href = redirectUrl;
  }, []);
