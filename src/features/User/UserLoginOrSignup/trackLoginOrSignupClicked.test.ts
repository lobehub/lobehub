import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackLoginOrSignupClicked } from './trackLoginOrSignupClicked';

const getSingletonAnalyticsOptional = vi.hoisted(() => vi.fn());
vi.mock('@lobehub/analytics', () => ({ getSingletonAnalyticsOptional }));

const makeAnalytics = (initialized = true) => {
  const track = vi.fn().mockResolvedValue(undefined);
  const initialize = vi.fn().mockResolvedValue(undefined);
  const analytics = {
    getStatus: () => ({ initialized, providersCount: 1 }),
    initialize,
    track,
  };
  return { analytics, initialize, track };
};

const resetEnv = () => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
};

describe('trackLoginOrSignupClicked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it('attaches the lh_cid from the current URL', async () => {
    const { analytics, track } = makeAnalytics();
    getSingletonAnalyticsOptional.mockReturnValue(analytics);
    window.history.replaceState({}, '', '/signup?lh_cid=cid-url');

    await trackLoginOrSignupClicked({ spm: 'signup.submit.click' });

    expect(track).toHaveBeenCalledWith({
      name: 'login_or_signup_clicked',
      properties: { lh_cid: 'cid-url', spm: 'signup.submit.click' },
    });
  });

  it('falls back to the lh_cid the shell beacon stored in sessionStorage', async () => {
    const { analytics, track } = makeAnalytics();
    getSingletonAnalyticsOptional.mockReturnValue(analytics);
    window.sessionStorage.setItem('lh_cid', 'cid-storage');

    await trackLoginOrSignupClicked({ provider: 'google', spm: 'signin.social.click' });

    expect(track).toHaveBeenCalledWith({
      name: 'login_or_signup_clicked',
      properties: { lh_cid: 'cid-storage', provider: 'google', spm: 'signin.social.click' },
    });
  });

  it('omits lh_cid entirely when no landing click id is present', async () => {
    const { analytics, track } = makeAnalytics();
    getSingletonAnalyticsOptional.mockReturnValue(analytics);

    await trackLoginOrSignupClicked({ spm: 'homepage.login_or_signup.click' });

    expect(track).toHaveBeenCalledWith({
      name: 'login_or_signup_clicked',
      properties: { spm: 'homepage.login_or_signup.click' },
    });
  });

  it('initializes analytics first when it is not yet initialized', async () => {
    const { analytics, initialize, track } = makeAnalytics(false);
    getSingletonAnalyticsOptional.mockReturnValue(analytics);

    await trackLoginOrSignupClicked({ spm: 'signin.email_step.submit' });

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('does not initialize again when analytics is already initialized', async () => {
    const { analytics, initialize, track } = makeAnalytics(true);
    getSingletonAnalyticsOptional.mockReturnValue(analytics);

    await trackLoginOrSignupClicked({ spm: 'signin.password_step.submit' });

    expect(initialize).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('no-ops without throwing when analytics is unavailable', async () => {
    getSingletonAnalyticsOptional.mockReturnValue(undefined);

    await expect(
      trackLoginOrSignupClicked({ spm: 'homepage.login_or_signup.click' }),
    ).resolves.toBeUndefined();
  });

  it('swallows and logs a tracking failure', async () => {
    const error = new Error('boom');
    const track = vi.fn().mockRejectedValue(error);
    getSingletonAnalyticsOptional.mockReturnValue({
      getStatus: () => ({ initialized: true, providersCount: 1 }),
      track,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await trackLoginOrSignupClicked({ spm: 'signup.submit.click' });

    expect(consoleError).toHaveBeenCalledWith('Failed to track login_or_signup_clicked:', error);
  });
});
