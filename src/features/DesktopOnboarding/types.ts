export enum DesktopOnboardingScreen {
  DataMode = 'data-mode',
  KeepAwake = 'keep-awake',
  Login = 'login',
  Permissions = 'permissions',
  Welcome = 'welcome',
}

export const isDesktopOnboardingScreen = (value: unknown): value is DesktopOnboardingScreen => {
  if (typeof value !== 'string') return false;
  return (Object.values(DesktopOnboardingScreen) as string[]).includes(value);
};
