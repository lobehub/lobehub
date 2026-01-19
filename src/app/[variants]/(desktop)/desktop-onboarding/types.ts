export enum DesktopOnboardingScreen {
  DataMode = 'data-mode',
  Login = 'login',
  Permissions = 'permissions',
  Welcome = 'welcome',
}

export const isDesktopOnboardingScreen = (value: unknown): value is DesktopOnboardingScreen => {
  if (typeof value !== 'string') return false;
  return (Object.values(DesktopOnboardingScreen) as string[]).includes(value);
};

export const desktopOnboardingLegacyStepToScreen = (
  step: number,
): DesktopOnboardingScreen | null => {
  switch (step) {
    case 1: {
      return DesktopOnboardingScreen.Welcome;
    }
    case 2: {
      return DesktopOnboardingScreen.Permissions;
    }
    case 3: {
      return DesktopOnboardingScreen.DataMode;
    }
    case 4: {
      return DesktopOnboardingScreen.Login;
    }
    // Legacy hash routing used `#5` in some places. Treat it as "login".
    case 5: {
      return DesktopOnboardingScreen.Login;
    }
    default: {
      return null;
    }
  }
};
