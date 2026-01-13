export const DESKTOP_ONBOARDING_STORAGE_KEY = 'lobechat:desktop:onboarding:completed:v1';
export const DESKTOP_ONBOARDING_STEP_KEY = 'lobechat:desktop:onboarding:step:v1';

export const getDesktopOnboardingCompleted = () => {
  if (typeof window === 'undefined') return true;

  try {
    return window.localStorage.getItem(DESKTOP_ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    // If localStorage is unavailable, treat as completed to avoid redirect loops.
    return true;
  }
};

export const setDesktopOnboardingCompleted = () => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(DESKTOP_ONBOARDING_STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
};

export const clearDesktopOnboardingCompleted = () => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.removeItem(DESKTOP_ONBOARDING_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};

/**
 * Get the persisted onboarding step (for restoring after app restart)
 */
export const getDesktopOnboardingStep = (): number | null => {
  if (typeof window === 'undefined') return null;

  try {
    const step = window.localStorage.getItem(DESKTOP_ONBOARDING_STEP_KEY);
    if (step) {
      const parsedStep = Number.parseInt(step, 10);
      if (parsedStep >= 1 && parsedStep <= 4) {
        return parsedStep;
      }
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Persist the current onboarding step
 */
export const setDesktopOnboardingStep = (step: number) => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(DESKTOP_ONBOARDING_STEP_KEY, step.toString());
    return true;
  } catch {
    return false;
  }
};

/**
 * Clear the persisted onboarding step (called when onboarding completes)
 */
export const clearDesktopOnboardingStep = () => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.removeItem(DESKTOP_ONBOARDING_STEP_KEY);
    return true;
  } catch {
    return false;
  }
};
