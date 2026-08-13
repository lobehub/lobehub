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
