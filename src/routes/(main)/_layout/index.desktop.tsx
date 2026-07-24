'use client';

import { HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { type CSSProperties, type FC } from 'react';
import { Suspense } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';

import WorkspaceContextSlot from '@/business/client/WorkspaceContextSlot';
import { isDesktop } from '@/const/version';
import { BANNER_HEIGHT } from '@/features/AlertBanner/CloudBanner';
import DesktopBrowserGatewayBridge from '@/features/DesktopBrowserGatewayBridge';
import DesktopFileMenuBridge from '@/features/DesktopFileMenuBridge';
import DesktopNavigationBridge from '@/features/DesktopNavigationBridge';
import AuthRequiredModal from '@/features/Electron/AuthRequiredModal';
import OverlayCaptureUploader from '@/features/Electron/ScreenCapture/OverlayCaptureUploader';
import OverlayMessageDispatcher from '@/features/Electron/ScreenCapture/OverlayMessageDispatcher';
import OverlaySnapshotPublisher from '@/features/Electron/ScreenCapture/OverlaySnapshotPublisher';
import ZoomHUD from '@/features/Electron/system/ZoomHUD';
import { TabHost, useSeedTabsOnBoot } from '@/features/Electron/TabHost';
import TabCacheBridges from '@/features/Electron/titlebar/TabBar/TabCacheBridges';
import TitleBar from '@/features/Electron/titlebar/TitleBar';
import HotkeyHelperPanel from '@/features/HotkeyHelperPanel';
import NavPanel from '@/features/NavPanel';
import { RouteMetaBridge } from '@/features/RouteMeta';
import { usePlatform } from '@/hooks/usePlatform';
import CmdkLazy from '@/layout/GlobalProvider/CmdkLazy';
import dynamic from '@/libs/next/dynamic';
import { DndContextWrapper } from '@/routes/(main)/resource/features/DndContextWrapper';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import DesktopAutoOidcOnFirstOpen from './DesktopAutoOidcOnFirstOpen';
import DesktopLayoutContainer from './DesktopLayoutContainer';
import RegisterHotkeys from './RegisterHotkeys';
import { styles } from './style';

const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'));
const GlobalApprovalNotification = dynamic(() => import('@/features/GlobalApprovalNotification'));

const tabHostContainer: CSSProperties = { position: 'relative' };

const Layout: FC = () => {
  const { isPWA } = usePlatform();
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);

  useSeedTabsOnBoot();

  return (
    <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
      <WorkspaceContextSlot>
        <RouteMetaBridge />
        {isDesktop && <TabCacheBridges />}
        <Suspense fallback={null}>
          {isDesktop && <DesktopAutoOidcOnFirstOpen />}
          {isDesktop && <DesktopNavigationBridge />}
          {isDesktop && <DesktopFileMenuBridge />}
          {isDesktop && <DesktopBrowserGatewayBridge />}
          {isDesktop && <OverlaySnapshotPublisher />}
          {isDesktop && <OverlayCaptureUploader />}
          {isDesktop && <OverlayMessageDispatcher />}
          {showCloudPromotion && <CloudBanner />}
        </Suspense>
        {isDesktop && <AuthRequiredModal />}
        {isDesktop && <ZoomHUD />}

        <Suspense fallback={null}>{isDesktop && <TitleBar />}</Suspense>
        <DndContextWrapper>
          <Flexbox
            horizontal
            className={cx(isPWA ? styles.mainContainerPWA : styles.mainContainer)}
            width={'100%'}
            height={
              isDesktop
                ? `calc(100% - ${TITLE_BAR_HEIGHT}px)`
                : showCloudPromotion
                  ? `calc(100% - ${BANNER_HEIGHT}px)`
                  : '100%'
            }
          >
            <NavPanel />
            <DesktopLayoutContainer>
              <Flexbox height={'100%'} style={tabHostContainer} width={'100%'}>
                <TabHost />
              </Flexbox>
            </DesktopLayoutContainer>
          </Flexbox>
        </DndContextWrapper>
        <Suspense fallback={null}>
          <HotkeyHelperPanel />
          <RegisterHotkeys />
          <CmdkLazy />
          <GlobalApprovalNotification />
        </Suspense>
      </WorkspaceContextSlot>
    </HotkeysProvider>
  );
};

export default Layout;
