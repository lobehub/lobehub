import { DesktopOnboardingScreen } from './types';

interface ResolveAdjacentScreenInput {
  current: DesktopOnboardingScreen;
  isMac: boolean;
}

interface ResolveNextScreenInput extends ResolveAdjacentScreenInput {
  everCompleted: boolean;
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
  isMac,
}: ResolveNextScreenInput): DesktopOnboardingScreen | null => {
  if (everCompleted && current === DesktopOnboardingScreen.Login) return null;

  const flow = getDesktopOnboardingFlow(isMac);
  const index = flow.indexOf(current);
  return flow[index + 1] ?? null;
};

export const resolvePreviousScreen = ({
  current,
  isMac,
}: ResolveAdjacentScreenInput): DesktopOnboardingScreen => {
  const flow = getDesktopOnboardingFlow(isMac);
  const index = flow.indexOf(current);
  return flow[Math.max(0, index - 1)] ?? DesktopOnboardingScreen.Login;
};
