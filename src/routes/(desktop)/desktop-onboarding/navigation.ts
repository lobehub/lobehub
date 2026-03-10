import { type DesktopOnboardingScreen } from './types';

const DESKTOP_ONBOARDING_ROUTE = '/desktop-onboarding';
export const getDesktopOnboardingPath = (screen?: DesktopOnboardingScreen) => {
  if (!screen) return DESKTOP_ONBOARDING_ROUTE;
  return `${DESKTOP_ONBOARDING_ROUTE}?screen=${encodeURIComponent(screen)}`;
};

export const navigateToDesktopOnboarding = (screen?: DesktopOnboardingScreen) => {
  location.href = getDesktopOnboardingPath(screen);
};
