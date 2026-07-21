import { describe, expect, it } from 'vitest';

import { resolveNextScreen, resolvePreviousScreen } from './flow';
import { DesktopOnboardingScreen } from './types';

describe('desktop onboarding flow', () => {
  describe('resolveNextScreen', () => {
    it('continues from Login to Welcome for a first-time user', () => {
      expect(
        resolveNextScreen({
          current: DesktopOnboardingScreen.Login,
          everCompleted: false,
          isMac: true,
        }),
      ).toBe(DesktopOnboardingScreen.Welcome);
    });

    it('finishes after Login for a returning user', () => {
      expect(
        resolveNextScreen({
          current: DesktopOnboardingScreen.Login,
          everCompleted: true,
          isMac: true,
        }),
      ).toBeNull();
    });

    it('continues from Welcome to Permissions on macOS', () => {
      expect(
        resolveNextScreen({
          current: DesktopOnboardingScreen.Welcome,
          everCompleted: false,
          isMac: true,
        }),
      ).toBe(DesktopOnboardingScreen.Permissions);
    });

    it('continues from Welcome to DataMode on non-macOS', () => {
      expect(
        resolveNextScreen({
          current: DesktopOnboardingScreen.Welcome,
          everCompleted: false,
          isMac: false,
        }),
      ).toBe(DesktopOnboardingScreen.DataMode);
    });

    it('finishes after DataMode for a first-time user', () => {
      expect(
        resolveNextScreen({
          current: DesktopOnboardingScreen.DataMode,
          everCompleted: false,
          isMac: true,
        }),
      ).toBeNull();
    });
  });

  describe('resolvePreviousScreen', () => {
    it('returns from Welcome to Login', () => {
      expect(
        resolvePreviousScreen({
          current: DesktopOnboardingScreen.Welcome,
          isMac: true,
        }),
      ).toBe(DesktopOnboardingScreen.Login);
    });
  });
});
