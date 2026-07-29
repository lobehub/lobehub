import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('prefers the current URL param over a stale sessionStorage id', () => {
    window.sessionStorage.setItem(LANDING_CLICK_ID_KEY, 'stale-cid-from-storage');
    window.history.replaceState({}, '', '/signup?lh_cid=fresh-cid-from-url');
    expect(resolveLandingClickId()).toBe('fresh-cid-from-url');
  });

  it('decodes an encoded lh_cid from the URL', () => {
    window.history.replaceState({}, '', `/signup?lh_cid=${encodeURIComponent('a b+c')}`);
    expect(resolveLandingClickId()).toBe('a b+c');
  });

  it('survives sessionStorage throwing (privacy mode) and still reads the URL', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    window.history.replaceState({}, '', '/signup?lh_cid=cid-from-url');
    expect(resolveLandingClickId()).toBe('cid-from-url');
  });

  it('returns undefined when sessionStorage throws and the URL has no id', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(resolveLandingClickId()).toBeUndefined();
  });
});
