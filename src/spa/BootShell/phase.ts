export const BOOT_SHELL_DELAY = 200;

export type BootShellPhase = 'done' | 'hidden' | 'shell';

interface ResolveBootShellPhaseOptions {
  appPainted: boolean;
  appReady: boolean;
  delayElapsed: boolean;
}

export const resolveBootShellPhase = ({
  appPainted,
  appReady,
  delayElapsed,
}: ResolveBootShellPhaseOptions): BootShellPhase => {
  if (appReady && appPainted) return 'done';

  return delayElapsed ? 'shell' : 'hidden';
};
