import { describe, expect, it } from 'vitest';

import { resolveInitialScreen } from './resolveInitialScreen';
import { DesktopOnboardingScreen } from './types';

describe('resolveInitialScreen', () => {
  it('returns Welcome for first-time users with no saved/requested screen', () => {
    expect(
      resolveInitialScreen({
        everCompleted: false,
        isMac: true,
        requested: null,
        saved: null,
      }),
    ).toBe(DesktopOnboardingScreen.Welcome);
  });

  it('returns Login when the user has previously completed onboarding (returning user)', () => {
    expect(
      resolveInitialScreen({
        everCompleted: true,
        isMac: true,
        requested: null,
        saved: null,
      }),
    ).toBe(DesktopOnboardingScreen.Login);
  });

  it('prefers the saved (in-progress) screen over the ever-completed fallback', () => {
    // Edge case: an in-progress user who somehow has ever-completed=true (e.g.
    // re-entered after first completion). The mid-flow position still wins.
    expect(
      resolveInitialScreen({
        everCompleted: true,
        isMac: true,
        requested: null,
        saved: DesktopOnboardingScreen.DataMode,
      }),
    ).toBe(DesktopOnboardingScreen.DataMode);
  });

  it('honours an explicit ?screen= URL parameter over everything else', () => {
    expect(
      resolveInitialScreen({
        everCompleted: true,
        isMac: true,
        requested: DesktopOnboardingScreen.Welcome,
        saved: DesktopOnboardingScreen.DataMode,
      }),
    ).toBe(DesktopOnboardingScreen.Welcome);
  });

  it('rewrites Permissions to DataMode on non-macOS', () => {
    expect(
      resolveInitialScreen({
        everCompleted: false,
        isMac: false,
        requested: DesktopOnboardingScreen.Permissions,
        saved: null,
      }),
    ).toBe(DesktopOnboardingScreen.DataMode);
  });
});
