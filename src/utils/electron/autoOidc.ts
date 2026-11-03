export const DESKTOP_AUTO_OIDC_FIRST_OPEN_STORAGE_KEY = 'lobechat:desktop:auto-oidc:first-open:v1';

/**
 * Whether the "desktop auto OIDC on first open" flow has been handled.
 *
 * - If localStorage is unavailable, treat it as handled to avoid repeated prompts.
 */
export const getDesktopAutoOidcFirstOpenHandled = () => {
  if (typeof window === 'undefined') return true;

  try {
    return window.localStorage.getItem(DESKTOP_AUTO_OIDC_FIRST_OPEN_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
};

/**
 * Mark the "desktop auto OIDC on first open" flow as handled.
 *
 * - Returns false if localStorage is unavailable.
 */
export const setDesktopAutoOidcFirstOpenHandled = () => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(DESKTOP_AUTO_OIDC_FIRST_OPEN_STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
};


