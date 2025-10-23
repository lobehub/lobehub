'use client';

import { SideNav } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { Suspense, memo } from 'react';

import { isDesktop } from '@/const/version';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { useIsSingleMode } from '@/hooks/useIsSingleMode';
import { usePinnedAgentState } from '@/hooks/usePinnedAgentState';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { electronStylish } from '@/styles/electron';

import Avatar from './Avatar';
import BottomActions from './BottomActions';
import PinList from './PinList';
import TopActions from './TopActions';

const Top = () => {
  const [isPinned] = usePinnedAgentState();
  const sidebarKey = useActiveTabKey();

  return <TopActions isPinned={isPinned} tab={sidebarKey} />;
};

const Nav = memo(() => {
  const theme = useTheme();
  const isSingleMode = useIsSingleMode();
  const inZenMode = useGlobalStore(systemStatusSelectors.inZenMode);
  const { showPinList } = useServerConfigStore(featureFlagsSelectors);

  return (
    !inZenMode &&
    !isSingleMode && (
      <SideNav
        avatar={
          <div className={electronStylish.nodrag}>
            <Avatar />
          </div>
        }
        bottomActions={
          <div className={electronStylish.nodrag}>
            <BottomActions />
          </div>
        }
        className={electronStylish.draggable}
        style={{
          height: '100%',
          zIndex: 100,
          ...(isDesktop
            ? { background: 'transparent', borderInlineEnd: 0, paddingBlockStart: 8 }
            : { background: theme.colorBgLayout }),
        }}
        topActions={
          <Suspense>
            <div
              className={electronStylish.nodrag}
              style={{
                display: 'flex',
                flexDirection: 'column',
                maxHeight: isDesktop ? 'calc(100vh - 180px)' : 'calc(100vh - 150px)',
              }}
            >
              <Top />
              {showPinList && <PinList />}
            </div>
          </Suspense>
        }
      />
    )
  );
});

Nav.displayName = 'DesktopNav';

export default Nav;
