'use client';

import { pwaInstallHandler } from 'pwa-install-handler';
import { memo, useEffect, useState } from 'react';

import { usePlatform } from '@/hooks/usePlatform';
import dynamic from '@/libs/next/dynamic';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';

const Install: any = dynamic(() => import('./Install'), {
  ssr: false,
});

const PWAInstall = memo(() => {
  const { isPWA, isSupportInstallPWA } = usePlatform();
  const isShowPWAGuide = useUserStore((s) => s.isShowPWAGuide);
  const hidePWAInstaller = useGlobalStore((s) => systemStatusSelectors.hidePWAInstaller(s));
  const [canInstallFromPWAInstallHandler, setCanInstallFromPWAInstallHandler] = useState<
    boolean | undefined
  >();

  useEffect(() => {
    pwaInstallHandler.addListener((canInstall) => {
      setCanInstallFromPWAInstallHandler(canInstall);
    });
    return () => {
      pwaInstallHandler.removeListener(setCanInstallFromPWAInstallHandler);
    };
  }, []);

  if (
    isPWA ||
    !isShowPWAGuide ||
    !isSupportInstallPWA ||
    hidePWAInstaller ||
    canInstallFromPWAInstallHandler === false
  )
    return null;

  // only when the user is suitable for the pwa install and not install the pwa
  // then show the installation guide
  return <Install />;
});

export default PWAInstall;
