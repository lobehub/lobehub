import { pwaInstallHandler } from 'pwa-install-handler';
import { useEffect, useState } from 'react';

import { PWA_INSTALL_ID } from '@/const/layoutTokens';
import { isOnServerSide } from '@/utils/env';

import { usePlatform } from './usePlatform';

export const usePWAInstall = () => {
  const [canInstall, setCanInstall] = useState(false);
  const { isSupportInstallPWA, isPWA } = usePlatform();

  useEffect(() => {
    if (isOnServerSide) return;
    pwaInstallHandler.addListener(setCanInstall);
    return () => {
      pwaInstallHandler.removeListener(setCanInstall);
    };
  }, []);

  const installCheck = () => {
    // Don't show install button when in PWA or environment that doesn't support PWA
    if (isPWA || !isSupportInstallPWA) return false;
    const pwa: any = document.querySelector(`#${PWA_INSTALL_ID}`);
    if (!pwa) return false;
    return canInstall;
  };

  return {
    canInstall: installCheck(),
    install: () => {
      const pwa: any = document.querySelector(`#${PWA_INSTALL_ID}`);
      if (!pwa) return;
      pwa.externalPromptEvent = pwaInstallHandler.getEvent();
      pwa?.showDialog(true);
    },
  };
};
