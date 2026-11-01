import { useEffect, useLayoutEffect, useState } from 'react';

import { useAppPainted, useAppReady } from '@/spa/atoms/app';
import { removeStaticLoadingScreen } from '@/spa/loadingScreen';

import { BOOT_SHELL_DELAY, type BootShellPhase, resolveBootShellPhase } from './phase';

export const useBootShell = (): BootShellPhase => {
  const appReady = useAppReady();
  const appPainted = useAppPainted();
  const [delayElapsed, setDelayElapsed] = useState(false);

  const phase = resolveBootShellPhase({ appPainted, appReady, delayElapsed });

  useEffect(() => {
    if (delayElapsed || phase === 'done') return;

    const timer = setTimeout(() => setDelayElapsed(true), BOOT_SHELL_DELAY);
    return () => clearTimeout(timer);
  }, [delayElapsed, phase]);

  useLayoutEffect(() => {
    if (phase === 'hidden') return;

    removeStaticLoadingScreen();
  }, [phase]);

  return phase;
};
