import { type DesktopOnboardingScreen } from './types';
import { isDesktopOnboardingScreen } from './types';

export const DESKTOP_ONBOARDING_SCREEN_KEY = 'lobechat:desktop:onboarding:screen:v1';

/**
 * Get the persisted onboarding screen (for restoring after app restart)
 */
export const getDesktopOnboardingScreen = () => {
  if (typeof window === 'undefined') return null;

  try {
    const screen = window.localStorage.getItem(DESKTOP_ONBOARDING_SCREEN_KEY);
    if (!screen) return null;
    if (!isDesktopOnboardingScreen(screen)) return null;
    return screen;
  } catch {
    return null;
  }
};

/**
 * Persist the current onboarding screen
 */
export const setDesktopOnboardingScreen = (screen: DesktopOnboardingScreen) => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(DESKTOP_ONBOARDING_SCREEN_KEY, screen);
    return true;
  } catch {
    return false;
  }
};

/**
 * Clear the persisted onboarding screen (called when onboarding completes)
 */
export const clearDesktopOnboardingScreen = () => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.removeItem(DESKTOP_ONBOARDING_SCREEN_KEY);
    return true;
  } catch {
    return false;
  }
};
