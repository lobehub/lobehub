const ONBOARDING_PATH = '/onboarding';
const CALLBACK_STORAGE_KEY = 'onboarding-callback-url';

/**
 * Only same-site relative paths are allowed as post-onboarding redirect
 * targets, to prevent open redirects (e.g. `https://evil.com`, `//evil.com`).
 */
export const isSafeRedirectPath = (url: string): boolean =>
  url.startsWith('/') && !url.startsWith('//');

/**
 * Build the first-hop URL for a freshly signed-up user. New users always land
 * on onboarding first; the original target (if any) is threaded through the
 * `callbackUrl` query param and restored when onboarding finishes.
 */
export const buildOnboardingRedirectUrl = (callbackUrl?: string | null): string => {
  if (!callbackUrl || callbackUrl === '/' || !isSafeRedirectPath(callbackUrl))
    return ONBOARDING_PATH;
  if (callbackUrl.startsWith(ONBOARDING_PATH)) return callbackUrl;
  return `${ONBOARDING_PATH}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
};

/**
 * Persist the threaded callbackUrl when landing on onboarding. sessionStorage
 * (rather than query threading) survives the internal multi-route hops of the
 * onboarding flow and mid-flow page refreshes.
 */
export const stashOnboardingCallbackUrl = (search: string): void => {
  try {
    const callbackUrl = new URLSearchParams(search).get('callbackUrl');
    if (callbackUrl && isSafeRedirectPath(callbackUrl))
      sessionStorage.setItem(CALLBACK_STORAGE_KEY, callbackUrl);
  } catch {
    // sessionStorage unavailable (e.g. privacy mode) — finish points fall back to defaults
  }
};

export const peekOnboardingCallbackUrl = (): string | undefined => {
  try {
    const url = sessionStorage.getItem(CALLBACK_STORAGE_KEY);
    return url && isSafeRedirectPath(url) ? url : undefined;
  } catch {
    return undefined;
  }
};

/** Read and clear the stashed callbackUrl — call once when onboarding finishes. */
export const consumeOnboardingCallbackUrl = (): string | undefined => {
  const url = peekOnboardingCallbackUrl();
  try {
    sessionStorage.removeItem(CALLBACK_STORAGE_KEY);
  } catch {
    // ignore
  }
  return url;
};
