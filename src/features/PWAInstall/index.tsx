'use client';

import dynamic from 'next/dynamic';
import { memo } from 'react';

import { useMounted } from '@/hooks/useMounted';
import { usePlatform } from '@/hooks/usePlatform';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';

const Install: any = dynamic(() => import('./Install'), {
  ssr: false,
});

const PWAInstall = memo(() => {
  const mounted = useMounted();
  const { isPWA, isSupportInstallPWA } = usePlatform();
  const isShowPWAGuide = useUserStore((s) => s.isShowPWAGuide);
  const hidePWAInstaller = useGlobalStore((s) => systemStatusSelectors.hidePWAInstaller(s));

  if (!mounted || isPWA || !isShowPWAGuide || !isSupportInstallPWA || hidePWAInstaller) {
    return null;
  }

  // only when the user is suitable for the pwa install and not install the pwa
  // then show the installation guide
  return <Install />;
});

export default PWAInstall;
