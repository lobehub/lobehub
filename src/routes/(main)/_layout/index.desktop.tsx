'use client';

import { HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type CSSProperties, type FC } from 'react';
import { Suspense } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';

import WorkspaceContextSlot from '@/business/client/WorkspaceContextSlot';
import DesktopBrowserGatewayBridge from '@/features/DesktopBrowserGatewayBridge';
import DesktopFileMenuBridge from '@/features/DesktopFileMenuBridge';
import DesktopLayoutContainer from '@/features/DesktopLayoutContainer';
import DesktopNavigationBridge from '@/features/DesktopNavigationBridge';
import ActiveConversationBridge from '@/features/Electron/ActiveConversationBridge';
import AuthRequiredModal from '@/features/Electron/AuthRequiredModal';
import HeteroRestartRecovery from '@/features/Electron/HeterogeneousAgent/RestartRecovery';
import OverlayCaptureUploader from '@/features/Electron/ScreenCapture/OverlayCaptureUploader';
import OverlayMessageDispatcher from '@/features/Electron/ScreenCapture/OverlayMessageDispatcher';
import OverlaySnapshotPublisher from '@/features/Electron/ScreenCapture/OverlaySnapshotPublisher';
import {
  useDesktopDocumentTitle,
  useLastWorkspaceSlugSync,
  useWindowUrlMirror,
} from '@/features/Electron/shell';
import LinkHoverStatus from '@/features/Electron/system/LinkHoverStatus';
import ZoomHUD from '@/features/Electron/system/ZoomHUD';
import { TabHost, useSeedTabsOnBoot } from '@/features/Electron/TabHost';
import TabCacheBridges from '@/features/Electron/titlebar/TabBar/TabCacheBridges';
import TitleBar from '@/features/Electron/titlebar/TitleBar';
import WorkspaceMentionNotifier from '@/features/Electron/WorkspaceMentionNotifier';
import HotkeyHelperPanel from '@/features/HotkeyHelperPanel';
import NavPanelShell from '@/features/NavPanel/Shell';
import NavRail from '@/features/NavRail';
import { useImLayout, useSyncImLayoutHint } from '@/features/NavRail/useImLayout';
import { wrapStyles } from '@/features/NavRail/wrapStyle';
import { DndContextWrapper } from '@/features/ResourceManager/DndContextWrapper';
import { usePlatform } from '@/hooks/usePlatform';
import CmdkLazy from '@/layout/GlobalProvider/CmdkLazy';
import dynamic from '@/libs/next/dynamic';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import ClientLlmWaitResume from './ClientLlmWaitResume';
import DesktopAutoOidcOnFirstOpen from './DesktopAutoOidcOnFirstOpen';
import GatewayMuxWarmup from './GatewayMuxWarmup';
import RegisterHotkeys from './RegisterHotkeys';
import { styles } from './style';

const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'));
const GlobalApprovalNotification = dynamic(() => import('@/features/GlobalApprovalNotification'));

const tabHostContainer: CSSProperties = { position: 'relative' };

const Layout: FC = () => {
  const { isPWA } = usePlatform();
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);
  // `im_layout` trial: icon rail + wrapped list column; off keeps this layout.
  const imLayout = useImLayout();
  useSyncImLayoutHint(imLayout);

  useSeedTabsOnBoot();
  useWindowUrlMirror();
  useLastWorkspaceSlugSync();
  useDesktopDocumentTitle();

  return (
    <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
      <DesktopAutoOidcOnFirstOpen />
      <AuthRequiredModal />
      <WorkspaceContextSlot>
        <ActiveConversationBridge />
        <TabCacheBridges />
        <Suspense fallback={null}>
          <DesktopNavigationBridge />
          <DesktopFileMenuBridge />
          <DesktopBrowserGatewayBridge />
          <OverlaySnapshotPublisher />
          <OverlayCaptureUploader />
          <OverlayMessageDispatcher />
          {showCloudPromotion && <CloudBanner />}
        </Suspense>
        <ZoomHUD />
        <LinkHoverStatus />

        <Suspense fallback={null}>
          <TitleBar />
        </Suspense>
        <DndContextWrapper>
          <Flexbox
            horizontal
            height={`calc(100% - ${TITLE_BAR_HEIGHT}px)`}
            width={'100%'}
            className={
              stylex.props(isPWA ? styles.mainContainerPWA : styles.mainContainer).className
            }
          >
            {imLayout ? (
              <>
                <NavRail />
                <Flexbox horizontal {...stylex.props(wrapStyles.wrap, wrapStyles.wrapDesktop)}>
                  <NavPanelShell />
                  <DesktopLayoutContainer flush>
                    <Flexbox height={'100%'} style={tabHostContainer} width={'100%'}>
                      <TabHost />
                    </Flexbox>
                  </DesktopLayoutContainer>
                </Flexbox>
              </>
            ) : (
              <>
                <NavPanelShell />
                <DesktopLayoutContainer>
                  <Flexbox height={'100%'} style={tabHostContainer} width={'100%'}>
                    <TabHost />
                  </Flexbox>
                </DesktopLayoutContainer>
              </>
            )}
          </Flexbox>
        </DndContextWrapper>
        <Suspense fallback={null}>
          <HotkeyHelperPanel />
          <GatewayMuxWarmup />
          <ClientLlmWaitResume />
          <HeteroRestartRecovery />
          <RegisterHotkeys />
          <CmdkLazy />
          <GlobalApprovalNotification />
          <WorkspaceMentionNotifier />
        </Suspense>
      </WorkspaceContextSlot>
    </HotkeysProvider>
  );
};

export default Layout;
