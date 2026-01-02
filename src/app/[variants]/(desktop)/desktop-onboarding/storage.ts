export const DESKTOP_ONBOARDING_STORAGE_KEY = 'lobechat:desktop:onboarding:completed:v1';

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
