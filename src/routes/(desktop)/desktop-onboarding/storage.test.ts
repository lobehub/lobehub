import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DESKTOP_ONBOARDING_EVER_COMPLETED_KEY,
  getDesktopOnboardingEverCompleted,
  setDesktopOnboardingEverCompleted,
} from './storage';

describe('desktop-onboarding storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe('ever-completed flag', () => {
    it('returns false by default', () => {
      expect(getDesktopOnboardingEverCompleted()).toBe(false);
    });

    it('persists set-and-read across calls', () => {
      expect(setDesktopOnboardingEverCompleted()).toBe(true);
      expect(getDesktopOnboardingEverCompleted()).toBe(true);
      expect(window.localStorage.getItem(DESKTOP_ONBOARDING_EVER_COMPLETED_KEY)).toBe('1');
    });

    it('returns false when localStorage holds an unrelated value', () => {
      window.localStorage.setItem(DESKTOP_ONBOARDING_EVER_COMPLETED_KEY, '0');
      expect(getDesktopOnboardingEverCompleted()).toBe(false);
    });
  });
});
