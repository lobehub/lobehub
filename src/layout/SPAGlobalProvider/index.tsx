'use client';

import { TooltipGroup } from '@lobehub/ui';
import { StyleProvider } from 'antd-style';
import { domMax, LazyMotion } from 'motion/react';
import { lazy, memo, type PropsWithChildren, Suspense } from 'react';

import { LobeAnalyticsProviderWrapper } from '@/components/Analytics/LobeAnalyticsProviderWrapper';
import { DragUploadProvider } from '@/components/DragUploadZone/DragUploadProvider';
import { isDesktop } from '@/const/version';
import AgentMockDevtools from '@/features/AgentMockDevtools';
import DevFeatureFlagPanel from '@/features/DevFeatureFlagPanel';
import AuthProvider from '@/layout/AuthProvider';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';
import AppTheme from '@/layout/GlobalProvider/AppTheme';
import CacheHydrationGate from '@/layout/GlobalProvider/CacheHydrationGate';
import DynamicFavicon from '@/layout/GlobalProvider/DynamicFavicon';
import { FaviconProvider } from '@/layout/GlobalProvider/FaviconProvider';
import { GroupWizardProvider } from '@/layout/GlobalProvider/GroupWizardProvider';
import QueryProvider from '@/layout/GlobalProvider/Query';
import ServerVersionOutdatedAlert from '@/layout/GlobalProvider/ServerVersionOutdatedAlert';
import StoreInitialization from '@/layout/GlobalProvider/StoreInitialization';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import type { SPAServerConfig } from '@/types/spaServerConfig';

import Locale from './Locale';

const ModalHost = lazy(() => import('@lobehub/ui').then((m) => ({ default: m.ModalHost })));
const BaseModalHost = lazy(() =>
  import('@lobehub/ui/base-ui').then((m) => ({ default: m.ModalHost })),
);
const ToastHost = lazy(() => import('@lobehub/ui/base-ui').then((m) => ({ default: m.ToastHost })));
const ContextMenuHost = lazy(() =>
  import('@lobehub/ui').then((m) => ({ default: m.ContextMenuHost })),
);

const SPAGlobalProvider = memo<PropsWithChildren>(({ children }) => {
  const serverConfig: SPAServerConfig | undefined = window.__SERVER_CONFIG__;

  const locale = document.documentElement.lang || 'en-US';
  const isMobile =
    (serverConfig?.isMobile ?? typeof __MOBILE__ !== 'undefined') ? __MOBILE__ : false;

  return (
    <Locale defaultLang={locale}>
      <AppTheme>
        <ServerConfigStoreProvider
          featureFlags={serverConfig?.featureFlags}
          isMobile={isMobile}
          serverConfig={serverConfig?.config}
        >
          <QueryProvider>
            <AuthProvider>
              <MarketAuthProvider isDesktop={isDesktop}>
                <StoreInitialization />

                {isDesktop && <ServerVersionOutdatedAlert />}
                <FaviconProvider>
                  <DynamicFavicon />
                  <GroupWizardProvider>
                    <DragUploadProvider>
                      <LazyMotion features={domMax}>
                        <TooltipGroup layoutAnimation={false}>
                          <StyleProvider speedy={import.meta.env.PROD}>
                            <LobeAnalyticsProviderWrapper>
                              <CacheHydrationGate>{children}</CacheHydrationGate>
                            </LobeAnalyticsProviderWrapper>
                          </StyleProvider>
                        </TooltipGroup>
                        <Suspense>
                          <ModalHost />
                          <BaseModalHost />
                          <ToastHost />
                          <ContextMenuHost />
                        </Suspense>
                      </LazyMotion>
                    </DragUploadProvider>
                  </GroupWizardProvider>
                </FaviconProvider>
              </MarketAuthProvider>
            </AuthProvider>
          </QueryProvider>
          <Suspense>
            {/* DevPanel disabled in SPA: depends on node:fs */}
            {__DEV__ && (
              <>
                <AgentMockDevtools />
                <DevFeatureFlagPanel />
              </>
            )}
          </Suspense>
        </ServerConfigStoreProvider>
      </AppTheme>
    </Locale>
  );
});

SPAGlobalProvider.displayName = 'SPAGlobalProvider';

export default SPAGlobalProvider;
