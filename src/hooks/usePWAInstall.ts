import { PWAInstallElement } from '@khmyznikov/pwa-install';
import { useEffect, useState } from 'react';

import { PWA_INSTALL_ID } from '@/const/layoutTokens';
import { isOnServerSide } from '@/utils/env';

import { usePlatform } from './usePlatform';

export const usePWAInstall = () => {
  const [canInstall, setCanInstall] = useState(false);
  const { isSupportInstallPWA, isPWA } = usePlatform();

  useEffect(() => {
    if (isOnServerSide) return;

    const pwa = document.querySelector(`#${PWA_INSTALL_ID}`) as PWAInstallElement;
    if (!pwa) return;

    // Pass the captured event if available
    if ((window as any).pwaPromptEvent) {
      pwa.externalPromptEvent = (window as any).pwaPromptEvent;
    }

    // Check initial state
    if (pwa.isInstallAvailable) {
      setCanInstall(true);
    }

    // Listen for install availability changes
    const handleInstallAvailable = () => {
      setCanInstall(true);
    };

    pwa.addEventListener('pwa-install-available-event', handleInstallAvailable);

    return () => {
      pwa.removeEventListener('pwa-install-available-event', handleInstallAvailable);
    };
  }, []);

  const installCheck = () => {
    if (isPWA || !isSupportInstallPWA) return false;
    return canInstall;
  };

  return {
    canInstall: installCheck(),
    install: () => {
      const pwa: any = document.querySelector(`#${PWA_INSTALL_ID}`);
      if (!pwa) return;
      pwa?.showDialog(true);
    },
  };
};
