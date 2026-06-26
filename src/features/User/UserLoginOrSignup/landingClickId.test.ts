import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LANDING_CLICK_ID_KEY, resolveLandingClickId } from './landingClickId';

const resetUrl = () => window.history.replaceState({}, '', '/');

describe('resolveLandingClickId', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    resetUrl();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    resetUrl();
  });

  it('returns undefined when nothing is set', () => {
    expect(resolveLandingClickId()).toBeUndefined();
  });

  it('reads the id the beacon stashed in sessionStorage', () => {
    window.sessionStorage.setItem(LANDING_CLICK_ID_KEY, 'cid-from-storage');
    expect(resolveLandingClickId()).toBe('cid-from-storage');
  });

  it('falls back to the lh_cid URL param when sessionStorage is empty', () => {
    window.history.replaceState({}, '', '/signup?lh_cid=cid-from-url');
    expect(resolveLandingClickId()).toBe('cid-from-url');
  });

  it('prefers sessionStorage over the URL param', () => {
    window.sessionStorage.setItem(LANDING_CLICK_ID_KEY, 'cid-from-storage');
    window.history.replaceState({}, '', '/signup?lh_cid=cid-from-url');
    expect(resolveLandingClickId()).toBe('cid-from-storage');
  });
});
