'use client';

import type { PWAInstallElement } from '@khmyznikov/pwa-install';
import { BRANDING_NAME } from '@lobechat/business-const';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PWA_INSTALL_ID } from '@/const/layoutTokens';
import { useMounted } from '@/hooks/useMounted';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';

const PWAInstall = memo(() => {
  const { t } = useTranslation('metadata');

  const mounted = useMounted();
  const pwaInstallRef = useRef<PWAInstallElement | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);

  const { install, canInstall } = usePWAInstall();

  const isShowPWAGuide = useUserStore((s) => s.isShowPWAGuide);
  const [hidePWAInstaller, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.hidePWAInstaller(s),
    s.updateSystemStatus,
  ]);

  // Initialize component: load PWA install library
  useEffect(() => {
    import('@khmyznikov/pwa-install').then(() => setLibraryReady(true));
  }, []);

  // Setup event listener for dismiss action and trigger PWA guide when needed
  useEffect(() => {
    if (!mounted) return;

    const element = pwaInstallRef.current;
    if (!element) return;

    const handler = (e: Event) => {
      const event = e as CustomEvent;
      // it means user hide installer
      if (event.detail.message === 'dismissed') {
        updateSystemStatus({ hidePWAInstaller: true });
      }
    };

    element.addEventListener('pwa-user-choice-result-event', handler);

    // trigger the PWA guide on demand
    if (canInstall && !hidePWAInstaller && isShowPWAGuide) {
      install();
      if ('serviceWorker' in navigator && window.serwist !== undefined) {
        window.serwist.register();
      }
    }

    return () => {
      element.removeEventListener('pwa-user-choice-result-event', handler);
    };
  }, [mounted, canInstall, hidePWAInstaller, install, isShowPWAGuide, updateSystemStatus]);

  if (!mounted || !libraryReady) return null;

  const description = t('chat.description', { appName: BRANDING_NAME });

  return (
    // @ts-expect-error - pwa-install is a custom element
    <pwa-install
      description={description}
      id={PWA_INSTALL_ID}
      manifest-url="/manifest.webmanifest"
      manual-apple="true"
      manual-chrome="true"
      ref={(el: PWAInstallElement | null) => {
        pwaInstallRef.current = el;
      }}
    />
  );
});

export default PWAInstall;
