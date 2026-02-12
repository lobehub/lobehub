'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { memo, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { PWA_INSTALL_ID } from '@/const/layoutTokens';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import dynamic from '@/libs/next/dynamic';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';

// @ts-ignore
const PWA: any = dynamic(() => import('@khmyznikov/pwa-install/dist/pwa-install.react.js'), {
  ssr: false,
});

const PWAInstall = memo(() => {
  const { t } = useTranslation('metadata');

  const { install, canInstall } = usePWAInstall();

  const isShowPWAGuide = useUserStore((s) => s.isShowPWAGuide);
  const [hidePWAInstaller, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.hidePWAInstaller(s),
    s.updateSystemStatus,
  ]);

  // we need to make the pwa installer hidden by default
  useLayoutEffect(() => {
    sessionStorage.setItem('pwa-hide-install', 'true');
  }, []);

  const pwaInstall =
     
    typeof window === 'undefined' ? undefined : document.getElementById(PWA_INSTALL_ID);

  // add an event listener to control the user close installer action
  useEffect(() => {
    if (!pwaInstall) return;

    const handler = (e: Event) => {
      const event = e as CustomEvent;

      // it means user hide installer
      if (event.detail.message === 'dismissed') {
        updateSystemStatus({ hidePWAInstaller: true });
      }
    };

    pwaInstall.addEventListener('pwa-user-choice-result-event', handler);
    return () => {
      pwaInstall.removeEventListener('pwa-user-choice-result-event', handler);
    };
  }, [pwaInstall]);

  // trigger the PWA guide on demand
  useEffect(() => {
    if (!canInstall || hidePWAInstaller) return;

    // trigger the pwa installer and register the service worker
    if (isShowPWAGuide) {
      install();
      if ('serviceWorker' in navigator && window.serwist !== undefined) {
        window.serwist.register();
      }
    }
  }, [canInstall, hidePWAInstaller, isShowPWAGuide]);

  return (
    <PWA
      description={t('chat.description', { appName: BRANDING_NAME })}
      id={PWA_INSTALL_ID}
      manifest-url={'/manifest.webmanifest'}
    />
  );
});

export default PWAInstall;
