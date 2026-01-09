import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo, useMemo } from 'react';

import { useElectronStore } from '@/store/electron';
import { electronStylish } from '@/styles/electron';
import { isMacOS } from '@/utils/platform';

import Connection from './Connection';
import NavigationBar from './NavigationBar';
import { UpdateModal } from './UpdateModal';
import { UpdateNotification } from './UpdateNotification';
import WinControl from './WinControl';
import { TITLE_BAR_HEIGHT } from './const';
import { useWatchThemeUpdate } from './hooks/useWatchThemeUpdate';

const isMac = isMacOS();

const TitleBar = memo(() => {
  const [isAppStateInit, initElectronAppState] = useElectronStore((s) => [
    s.isAppStateInit,
    s.useInitElectronAppState,
  ]);

  initElectronAppState();
  useWatchThemeUpdate();

  const showWinControl = isAppStateInit && !isMac;

  const padding = useMemo(() => {
    if (showWinControl) {
      return '0 12px 0 0';
    }

    return '0 12px';
  }, [showWinControl, isMac]);

  return (
    <Flexbox
      align={'center'}
      className={electronStylish.draggable}
      height={TITLE_BAR_HEIGHT}
      horizontal
      justify={'space-between'}
      style={{ minHeight: TITLE_BAR_HEIGHT, padding }}
      width={'100%'}
    >
      <NavigationBar />

      <Flexbox align={'center'} gap={4} horizontal>
        <Flexbox className={electronStylish.nodrag} gap={8} horizontal>
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
      <UpdateModal />
    </Flexbox>
  );
});

export default TitleBar;

export { TITLE_BAR_HEIGHT } from './const';
