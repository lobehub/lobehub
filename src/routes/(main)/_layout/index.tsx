'use client';

import { HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { type FC } from 'react';
import { Suspense } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { Outlet } from 'react-router';

import WorkspaceContextSlot from '@/business/client/WorkspaceContextSlot';
import RouteSegmentSkeleton from '@/components/Skeleton/RouteSegment';
import { useIsAgentShareVisitorRoute } from '@/features/AgentRoute/useAgentShareVisitorRoute';
import { BANNER_HEIGHT } from '@/features/AlertBanner/CloudBanner';
import DesktopLayoutContainer from '@/features/DesktopLayoutContainer';
import HotkeyHelperPanel from '@/features/HotkeyHelperPanel';
import NavPanelShell from '@/features/NavPanel/Shell';
import { DndContextWrapper } from '@/features/ResourceManager/DndContextWrapper';
import { RouteMetaBridge } from '@/features/RouteMeta';
import { usePlatform } from '@/hooks/usePlatform';
import CmdkLazy from '@/layout/GlobalProvider/CmdkLazy';
import dynamic from '@/libs/next/dynamic';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import DesktopHome from '../home';
import DesktopHomeLayout from '../home/_layout';
import RegisterHotkeys from './RegisterHotkeys';
import { styles } from './style';

const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'));
const GlobalApprovalNotification = dynamic(() => import('@/features/GlobalApprovalNotification'));

const Layout: FC = () => {
  const { isPWA } = usePlatform();
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);
  // An agent-share visitor has no access to the nav's data, so the panel would
  // stay a grey skeleton — unmount it for that branch of `/agent/:aid`.
  const isShareVisitor = useIsAgentShareVisitorRoute();

  return (
    <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
      <WorkspaceContextSlot>
        <RouteMetaBridge />
        <Suspense fallback={null}>{showCloudPromotion && <CloudBanner />}</Suspense>
        <DndContextWrapper>
          <Flexbox
            horizontal
            className={cx(isPWA ? styles.mainContainerPWA : styles.mainContainer)}
            height={showCloudPromotion ? `calc(100% - ${BANNER_HEIGHT}px)` : '100%'}
            width={'100%'}
          >
            {!isShareVisitor && <NavPanelShell />}
            <DesktopLayoutContainer>
              <DesktopHomeLayout>
                <DesktopHome />
              </DesktopHomeLayout>
              <Suspense fallback={<RouteSegmentSkeleton />}>
                <Outlet />
              </Suspense>
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
