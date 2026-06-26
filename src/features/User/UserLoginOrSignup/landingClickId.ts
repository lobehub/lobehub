/**
 * Landing → app correlation id.
 *
 * The marketing site (lobehub-landing) generates a fresh `lh_cid` for every
 * "open app" click, appends it to the destination URL, and the app shell's
 * load-funnel beacon persists it to `sessionStorage` on arrival. Surfacing it on
 * auth events lets growth analytics chain a single landing click all the way to a
 * completed registration by `lh_cid` — instead of relying on coarse first-touch
 * (`$initial_utm_source`) attribution.
 */
export const LANDING_CLICK_ID_KEY = 'lh_cid';

const fromSessionStorage = (): string => {
  try {
    return globalThis.sessionStorage?.getItem(LANDING_CLICK_ID_KEY) ?? '';
  } catch {
    // sessionStorage can throw (SSR, privacy mode, disabled storage)
    return '';
  }
};

const fromUrl = (): string => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get(LANDING_CLICK_ID_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * Resolve the landing click id, preferring the value the shell beacon stashed in
 * `sessionStorage` and falling back to the current URL (e.g. a direct
 * `/signup?lh_cid=...` deep link the beacon may not have processed). Returns
 * `undefined` when absent so callers can omit the property entirely.
 */
export const resolveLandingClickId = (): string | undefined => {
  const cid = fromSessionStorage() || fromUrl();
  return cid || undefined;
};
