import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackLoginOrSignupClicked } from './trackLoginOrSignupClicked';

const track = vi.hoisted(() => vi.fn());
vi.mock('@/libs/analytics/client', () => ({ analyticsClient: { track } }));

const resetEnv = () => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
};

describe('trackLoginOrSignupClicked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    track.mockResolvedValue(undefined);
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it('attaches the lh_cid from the current URL', async () => {
    window.history.replaceState({}, '', '/signup?lh_cid=cid-url');

    await trackLoginOrSignupClicked({ spm: 'signup.submit.click' });

    expect(track).toHaveBeenCalledWith({
      name: 'login_or_signup_clicked',
      properties: { lh_cid: 'cid-url', spm: 'signup.submit.click' },
    });
  });

  it('falls back to the lh_cid the shell beacon stored in sessionStorage', async () => {
    window.sessionStorage.setItem('lh_cid', 'cid-storage');

    await trackLoginOrSignupClicked({ provider: 'google', spm: 'signin.social.click' });

    expect(track).toHaveBeenCalledWith({
      name: 'login_or_signup_clicked',
      properties: { lh_cid: 'cid-storage', provider: 'google', spm: 'signin.social.click' },
    });
  });

  it('omits lh_cid entirely when no landing click id is present', async () => {
    await trackLoginOrSignupClicked({ spm: 'homepage.login_or_signup.click' });

    expect(track).toHaveBeenCalledWith({
      name: 'login_or_signup_clicked',
      properties: { spm: 'homepage.login_or_signup.click' },
    });
  });

  it('swallows and logs a tracking failure', async () => {
    const error = new Error('boom');
    track.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await trackLoginOrSignupClicked({ spm: 'signup.submit.click' });

    expect(consoleError).toHaveBeenCalledWith('Failed to track login_or_signup_clicked:', error);
  });
});
