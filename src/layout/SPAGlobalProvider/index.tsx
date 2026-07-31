'use client';

import { ContextMenuHost, ModalHost, TooltipGroup } from '@lobehub/ui';
import { ModalHost as BaseModalHost, ToastHost } from '@lobehub/ui/base-ui';
import { StyleProvider } from 'antd-style';
import { domMax, LazyMotion } from 'motion/react';
import { Component, type CSSProperties, lazy, memo, type PropsWithChildren, Suspense } from 'react';

import { LobeAnalyticsProviderWrapper } from '@/components/Analytics/LobeAnalyticsProviderWrapper';
import { DragUploadProvider } from '@/components/DragUploadZone/DragUploadProvider';
import { isDesktop } from '@/const/version';
import { useDevDockMounted } from '@/hooks/useDevDockMounted';
import AuthProvider from '@/layout/AuthProvider';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';
import AppBootstrapGate from '@/layout/GlobalProvider/AppBootstrapGate';
import AppTheme from '@/layout/GlobalProvider/AppTheme';
import CacheHydrationGate from '@/layout/GlobalProvider/CacheHydrationGate';
import ClientDataHydrationGate from '@/layout/GlobalProvider/ClientDataHydrationGate';
import { FaviconProvider } from '@/layout/GlobalProvider/FaviconProvider';
import { GroupWizardProvider } from '@/layout/GlobalProvider/GroupWizardProvider';
import QueryProvider from '@/layout/GlobalProvider/Query';
import ServerVersionOutdatedAlert from '@/layout/GlobalProvider/ServerVersionOutdatedAlert';
import StoreInitialization from '@/layout/GlobalProvider/StoreInitialization';
import { registerNativeContextMenuInterceptor } from '@/libs/contextMenu';
import { usePostRenderReady } from '@/spa/atoms/app';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import type { SPAServerConfig } from '@/types/spaServerConfig';

import Locale from './Locale';

registerNativeContextMenuInterceptor();
const DevDock = lazy(() => import('@/features/DevDock'));
const ImperativeMountHost = lazy(() => import('@/components/ImperativeMount'));
const DynamicFavicon = lazy(() => import('@/layout/GlobalProvider/DynamicFavicon'));

const devDockLayoutStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flex: 1,
  flexDirection: 'column',
  minHeight: 0,
  width: '100%',
};

class DevDockBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export const DevDockLayout = memo<PropsWithChildren>(({ children }) => {
  const mounted = useDevDockMounted();

  return (
    <>
      <div style={devDockLayoutStyle}>{children}</div>
      {mounted && (
        <DevDockBoundary>
          <Suspense>
            <DevDock />
          </Suspense>
        </DevDockBoundary>
      )}
    </>
  );
});

DevDockLayout.displayName = 'DevDockLayout';

const SPAGlobalProvider = memo<PropsWithChildren>(({ children }) => {
  const postRenderReady = usePostRenderReady();
  const serverConfig: SPAServerConfig | undefined = window.__SERVER_CONFIG__;

  const locale = document.documentElement.lang || 'en-US';
  const isMobile =
    (serverConfig?.isMobile ?? typeof __MOBILE__ !== 'undefined') ? __MOBILE__ : false;

  const content = (
    <AuthProvider>
      <MarketAuthProvider isDesktop={isDesktop}>
        <StoreInitialization />

        {isDesktop && <ServerVersionOutdatedAlert />}
        <FaviconProvider>
          {postRenderReady && (
            <Suspense>
              <DynamicFavicon />
            </Suspense>
          )}
          <GroupWizardProvider>
            <DragUploadProvider>
              <LazyMotion features={domMax}>
                <TooltipGroup layoutAnimation={false}>
                  <StyleProvider speedy={import.meta.env.PROD}>
                    <LobeAnalyticsProviderWrapper>
                      <AppBootstrapGate>
                        <ClientDataHydrationGate>
                          <CacheHydrationGate>
                            <DevDockLayout>{children}</DevDockLayout>
                          </CacheHydrationGate>
                        </ClientDataHydrationGate>
                      </AppBootstrapGate>
                    </LobeAnalyticsProviderWrapper>
                  </StyleProvider>
                </TooltipGroup>
                <ModalHost />
                <BaseModalHost />
                <ToastHost />
                <ContextMenuHost />
                <Suspense>
                  <ImperativeMountHost />
                </Suspense>
              </LazyMotion>
            </DragUploadProvider>
          </GroupWizardProvider>
        </FaviconProvider>
      </MarketAuthProvider>
    </AuthProvider>
  );

  return (
    <Locale defaultLang={locale}>
      <AppTheme>
        <ServerConfigStoreProvider
          featureFlags={serverConfig?.featureFlags}
          isMobile={isMobile}
          serverConfig={serverConfig?.config}
        >
          <QueryProvider>{content}</QueryProvider>
        </ServerConfigStoreProvider>
      </AppTheme>
    </Locale>
  );
});

SPAGlobalProvider.displayName = 'SPAGlobalProvider';

export default SPAGlobalProvider;
