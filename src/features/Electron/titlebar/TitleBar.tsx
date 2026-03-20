import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo, useMemo } from 'react';

import { electronStylish } from '@/styles/electron';
import { getPlatform, isMacOS } from '@/utils/platform';

import Connection from '../connection/Connection';
import { useTabNavigation } from '../navigation/useTabNavigation';
import { useWatchThemeUpdate } from '../system/useWatchThemeUpdate';
import { UpdateNotification } from '../updater/UpdateNotification';
import NavigationBar from './NavigationBar';
import TabBar from './TabBar';
import WinControl from './WinControl';

const isMac = isMacOS();
const isLinux = getPlatform() === 'Linux';

const TitleBar = memo(() => {
  useWatchThemeUpdate();
  useTabNavigation();

  const showWinControl = isLinux && !isMac;

  const padding = useMemo(() => {
    if (showWinControl) {
      return '0 12px 0 0';
    }

    return '0 12px';
  }, [showWinControl]);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={electronStylish.draggable}
      height={TITLE_BAR_HEIGHT}
      justify={'space-between'}
      style={{ minHeight: TITLE_BAR_HEIGHT, padding }}
      width={'100%'}
    >
      <NavigationBar />
      <TabBar />

      <Flexbox horizontal align={'center'} gap={4}>
        <Flexbox horizontal className={electronStylish.nodrag} gap={8}>
          <UpdateNotification />
          <Connection />
        </Flexbox>
        {showWinControl && (
          <>
            <Divider orientation={'vertical'} />
            <WinControl />
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default TitleBar;
