import { DesktopOnboardingScreen } from './types';

interface ResolveInitialScreenInput {
  /** Running on macOS — drives the Permissions screen fallback. */
  isMac: boolean;
  /** Explicit `?screen=` query parameter, when present and valid. */
  requested: DesktopOnboardingScreen | null;
  /** Whatever screen the component last persisted, or `null` if cleared/missing. */
  saved: DesktopOnboardingScreen | null;
}

/**
 * Pick which onboarding screen the user should land on when entering
 * `/desktop-onboarding`. Priority:
 *
 * 1. `requested` from the URL — explicit deep-link wins.
 * 2. `saved` — a mid-flow user resumes where they left off.
 * 3. `Login`. Authentication is the first onboarding step.
 *
 * On non-macOS, `Permissions` is rewritten to `DataMode` since the macOS-only
 * screen has no useful content.
 */
export const resolveInitialScreen = ({
  isMac,
  requested,
  saved,
}: ResolveInitialScreenInput): DesktopOnboardingScreen => {
  const fallback = DesktopOnboardingScreen.Login;
  const chosen = requested ?? saved ?? fallback;

  if (!isMac && chosen === DesktopOnboardingScreen.Permissions) {
    return DesktopOnboardingScreen.DataMode;
  }
  return chosen;
};
