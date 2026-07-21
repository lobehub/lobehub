import { describe, expect, it } from 'vitest';

import { resolveNextScreen, resolvePreviousScreen } from './flow';
import { DesktopOnboardingScreen } from './types';

describe('desktop onboarding flow', () => {
  describe('resolveNextScreen', () => {
    it('continues from Welcome to Login for a first-time user', () => {
      expect(
        resolveNextScreen({
          current: DesktopOnboardingScreen.Welcome,
          everCompleted: false,
          isMac: true,
        }),
      ).toBe(DesktopOnboardingScreen.Login);
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

    it('continues from Login to Permissions on macOS', () => {
      expect(
        resolveNextScreen({
          current: DesktopOnboardingScreen.Login,
          everCompleted: false,
          isMac: true,
        }),
      ).toBe(DesktopOnboardingScreen.Permissions);
    });

    it('continues from Login to DataMode on non-macOS', () => {
      expect(
        resolveNextScreen({
          current: DesktopOnboardingScreen.Login,
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
    it('returns from Login to Welcome', () => {
      expect(
        resolvePreviousScreen({
          current: DesktopOnboardingScreen.Login,
          isMac: true,
        }),
      ).toBe(DesktopOnboardingScreen.Welcome);
    });

    it('returns from Permissions to Login', () => {
      expect(
        resolvePreviousScreen({
          current: DesktopOnboardingScreen.Permissions,
          isMac: true,
        }),
      ).toBe(DesktopOnboardingScreen.Login);
    });
  });
});
