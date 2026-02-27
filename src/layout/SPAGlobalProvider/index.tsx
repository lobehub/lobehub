'use client';

import { TooltipGroup } from '@lobehub/ui';
import { StyleProvider } from 'antd-style';
import { domMax, LazyMotion } from 'motion/react';
import { lazy, memo, type PropsWithChildren, Suspense, useLayoutEffect } from 'react';

import { LobeAnalyticsProviderWrapper } from '@/components/Analytics/LobeAnalyticsProviderWrapper';
import { DragUploadProvider } from '@/components/DragUploadZone/DragUploadProvider';
import { isDesktop } from '@/const/version';
import AuthProvider from '@/layout/AuthProvider';
import AppTheme from '@/layout/GlobalProvider/AppTheme';
import { FaviconProvider } from '@/layout/GlobalProvider/FaviconProvider';
import { GroupWizardProvider } from '@/layout/GlobalProvider/GroupWizardProvider';
import ImportSettings from '@/layout/GlobalProvider/ImportSettings';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import QueryProvider from '@/layout/GlobalProvider/Query';
import ServerVersionOutdatedAlert from '@/layout/GlobalProvider/ServerVersionOutdatedAlert';
import StoreInitialization from '@/layout/GlobalProvider/StoreInitialization';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import type { SPAServerConfig } from '@/types/spaServerConfig';

import Locale from './Locale';

const ModalHost = lazy(() => import('@lobehub/ui').then((m) => ({ default: m.ModalHost })));
const ToastHost = lazy(() => import('@lobehub/ui').then((m) => ({ default: m.ToastHost })));
const ContextMenuHost = lazy(() =>
  import('@lobehub/ui').then((m) => ({ default: m.ContextMenuHost })),
);

const SPAGlobalProvider = memo<PropsWithChildren>(({ children }) => {
  useLayoutEffect(() => {
    document.getElementById('loading-screen')?.remove();
  }, []);

  const serverConfig: SPAServerConfig | undefined = window.__SERVER_CONFIG__;

  const locale = document.documentElement.lang || 'en-US';
  const isMobile =
    (serverConfig?.isMobile ?? typeof __MOBILE__ !== 'undefined') ? __MOBILE__ : false;

  return (
    <Locale defaultLang={locale}>
      <NextThemeProvider>
        <AppTheme>
          <ServerConfigStoreProvider
            featureFlags={serverConfig?.featureFlags}
            isMobile={isMobile}
            serverConfig={serverConfig?.config}
          >
            <QueryProvider>
              <AuthProvider>
                <StoreInitialization />

                {isDesktop && <ServerVersionOutdatedAlert />}
                <FaviconProvider>
                  <GroupWizardProvider>
                    <DragUploadProvider>
                      <LazyMotion features={domMax}>
                        <TooltipGroup layoutAnimation={false}>
                          <StyleProvider speedy={import.meta.env.PROD}>
                            <LobeAnalyticsProviderWrapper>{children}</LobeAnalyticsProviderWrapper>
                          </StyleProvider>
                        </TooltipGroup>
                        <Suspense>
                          <ModalHost />
                          <ToastHost />
                          <ContextMenuHost />
                        </Suspense>
                      </LazyMotion>
                    </DragUploadProvider>
                  </GroupWizardProvider>
                </FaviconProvider>
              </AuthProvider>
            </QueryProvider>
            <Suspense>
              <ImportSettings />
              {/* DevPanel disabled in SPA: depends on node:fs */}
            </Suspense>
          </ServerConfigStoreProvider>
        </AppTheme>
      </NextThemeProvider>
    </Locale>
  );
});

SPAGlobalProvider.displayName = 'SPAGlobalProvider';

export default SPAGlobalProvider;
