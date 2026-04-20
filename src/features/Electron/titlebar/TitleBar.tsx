import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo } from 'react';

import { electronStylish } from '@/styles/electron';
import { getPlatform } from '@/utils/platform';

import Connection from '../connection/Connection';
import DeviceGateway from '../connection/DeviceGateway';
import { useTabNavigation } from '../navigation/useTabNavigation';
import { useWatchThemeUpdate } from '../system/useWatchThemeUpdate';
import { UpdateNotification } from '../updater/UpdateNotification';
import { getTitleBarLayoutConfig } from './layout';
import NavigationBar from './NavigationBar';
import TabBar from './TabBar';
import WinControl from './WinControl';

const platform = getPlatform();

const TitleBar = memo(() => {
  useWatchThemeUpdate();
  useTabNavigation();

  const { padding, showCustomWinControl } = getTitleBarLayoutConfig(platform);

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
          <DeviceGateway />
          <Connection />
        </Flexbox>
        {showCustomWinControl && (
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
