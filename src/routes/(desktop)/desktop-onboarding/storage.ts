import { type DesktopOnboardingScreen } from './types';
import { isDesktopOnboardingScreen } from './types';

export const DESKTOP_ONBOARDING_COMPLETED_KEY = 'lobechat:desktop:onboarding:completed:v1';
export const DESKTOP_ONBOARDING_SCREEN_KEY = 'lobechat:desktop:onboarding:screen:v1';

/**
 * Check if user has completed onboarding in this session
 * Uses sessionStorage so it clears when the browser session ends
 */
export const getDesktopOnboardingCompleted = () => {
  if (typeof window === 'undefined') return false;

  try {
    return window.sessionStorage.getItem(DESKTOP_ONBOARDING_COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Mark onboarding as completed for this session
 */
export const setDesktopOnboardingCompleted = () => {
  if (typeof window === 'undefined') return false;

  try {
    window.sessionStorage.setItem(DESKTOP_ONBOARDING_COMPLETED_KEY, '1');
    return true;
  } catch {
    return false;
  }
};

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
