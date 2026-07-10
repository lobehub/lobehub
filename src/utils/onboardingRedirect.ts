const ONBOARDING_PATH = '/onboarding';
const CALLBACK_STORAGE_KEY = 'onboarding-callback-url';

/**
 * Only same-site relative paths are allowed as post-onboarding redirect
 * targets, to prevent open redirects (e.g. `https://evil.com`, `//evil.com`).
 * Backslashes are rejected because browsers normalize `\` to `/` in
 * navigations, so `/\evil.com` would escape as a protocol-relative URL.
 */
export const isSafeRedirectPath = (url: string): boolean =>
  url.startsWith('/') && !url.startsWith('//') && !url.includes('\\');

/**
 * Auth detours can produce same-origin absolute callback URLs (e.g. the
 * protected-route proxy builds `APP_URL + pathname + search`) — normalize
 * them to relative paths instead of dropping them as unsafe.
 */
const toRelativePath = (url: string): string => {
  if (!/^https?:\/\//.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin)
      return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    // fall through — non-parsable URLs are rejected by isSafeRedirectPath
  }
  return url;
};

/**
 * Sanitize a user-supplied redirect target before it reaches
 * `window.location.href`: same-origin absolute URLs are normalized to relative
 * paths, anything unsafe (`javascript:`, `https://evil.com`, `//…`) falls back.
 */
export const sanitizeRedirectPath = (url: string | null | undefined, fallback = '/'): string => {
  if (!url) return fallback;
  const target = toRelativePath(url);
  return isSafeRedirectPath(target) ? target : fallback;
};

/**
 * Build the first-hop URL for a freshly signed-up user. New users always land
 * on onboarding first; the original target (if any) is threaded through the
 * `callbackUrl` query param and restored when onboarding finishes.
 */
export const buildOnboardingRedirectUrl = (callbackUrl?: string | null): string => {
  const target = callbackUrl && toRelativePath(callbackUrl);
  if (!target || target === '/' || !isSafeRedirectPath(target)) return ONBOARDING_PATH;
  if (target.startsWith(ONBOARDING_PATH)) return target;
  return `${ONBOARDING_PATH}?callbackUrl=${encodeURIComponent(target)}`;
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

/**
 * Drop a stale stashed callback left by a previously abandoned onboarding
 * attempt in this tab. Only a fresh top-level entry (`/onboarding` without a
 * valid `callbackUrl`) may clear: internal navigations either stay on branch
 * paths (`/onboarding/agent`, `/onboarding/classic`) or re-enter the shared
 * prefix with an explicit `?step` param, and must keep the stash intact.
 */
export const clearStaleOnboardingCallbackUrl = (pathname: string, search: string): void => {
  if (pathname !== ONBOARDING_PATH) return;
  const params = new URLSearchParams(search);
  if (params.has('step')) return;
  const callbackUrl = params.get('callbackUrl');
  if (callbackUrl && isSafeRedirectPath(callbackUrl)) return;
  try {
    sessionStorage.removeItem(CALLBACK_STORAGE_KEY);
  } catch {
    // ignore
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
