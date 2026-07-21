import { DesktopOnboardingScreen } from './types';

interface ResolveAdjacentScreenInput {
  current: DesktopOnboardingScreen;
  isMac: boolean;
}

interface ResolveNextScreenInput extends ResolveAdjacentScreenInput {
  everCompleted: boolean;
  isAuthenticated: boolean;
}

const getDesktopOnboardingFlow = (isMac: boolean) =>
  isMac
    ? [
        DesktopOnboardingScreen.Welcome,
        DesktopOnboardingScreen.Login,
        DesktopOnboardingScreen.Permissions,
        DesktopOnboardingScreen.DataMode,
      ]
    : [
        DesktopOnboardingScreen.Welcome,
        DesktopOnboardingScreen.Login,
        DesktopOnboardingScreen.DataMode,
      ];

export const resolveNextScreen = ({
  current,
  everCompleted,
  isAuthenticated,
  isMac,
}: ResolveNextScreenInput): DesktopOnboardingScreen | null => {
  if (current === DesktopOnboardingScreen.Login && !isAuthenticated) {
    return DesktopOnboardingScreen.Login;
  }
  if (everCompleted && current === DesktopOnboardingScreen.Login) return null;

  const flow = getDesktopOnboardingFlow(isMac);
  const index = flow.indexOf(current);
  const next = flow[index + 1] ?? null;

  return next ?? (isAuthenticated ? null : DesktopOnboardingScreen.Login);
};

export const resolvePreviousScreen = ({
  current,
  isMac,
}: ResolveAdjacentScreenInput): DesktopOnboardingScreen => {
  const flow = getDesktopOnboardingFlow(isMac);
  const index = flow.indexOf(current);
  return flow[Math.max(0, index - 1)] ?? DesktopOnboardingScreen.Login;
};
