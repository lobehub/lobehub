import { describe, expect, it } from 'vitest';

import { resolveInitialScreen } from './resolveInitialScreen';
import { DesktopOnboardingScreen } from './types';

describe('resolveInitialScreen', () => {
  it('returns Login when there is no saved or requested screen', () => {
    expect(
      resolveInitialScreen({
        isMac: true,
        requested: null,
        saved: null,
      }),
    ).toBe(DesktopOnboardingScreen.Login);
  });

  it('prefers the saved in-progress screen over the fallback', () => {
    expect(
      resolveInitialScreen({
        isMac: true,
        requested: null,
        saved: DesktopOnboardingScreen.DataMode,
      }),
    ).toBe(DesktopOnboardingScreen.DataMode);
  });

  it('honours an explicit ?screen= URL parameter over everything else', () => {
    expect(
      resolveInitialScreen({
        isMac: true,
        requested: DesktopOnboardingScreen.Welcome,
        saved: DesktopOnboardingScreen.DataMode,
      }),
    ).toBe(DesktopOnboardingScreen.Welcome);
  });

  it('rewrites Permissions to DataMode on non-macOS', () => {
    expect(
      resolveInitialScreen({
        isMac: false,
        requested: DesktopOnboardingScreen.Permissions,
        saved: null,
      }),
    ).toBe(DesktopOnboardingScreen.DataMode);
  });
});
