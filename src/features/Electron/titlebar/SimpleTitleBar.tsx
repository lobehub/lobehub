'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import { ProductLogo } from '@/components/Branding/ProductLogo';
import { useElectronStore } from '@/store/electron';
import { electronStylish } from '@/styles/electron';
import { isMacOS } from '@/utils/platform';

import { useWatchThemeUpdate } from '../system/useWatchThemeUpdate';
import WinControl, { WINDOW_CONTROL_WIDTH } from './WinControl';

const isMac = isMacOS();

/**
 * A simple, minimal TitleBar for Electron windows.
 * Provides draggable area without business logic (navigation, updates, etc.)
 * Use this for secondary windows like onboarding, settings, etc.
 */
const SimpleTitleBar: FC = () => {
  const [isAppStateInit, isLinux, initElectronAppState] = useElectronStore((s) => [
    s.isAppStateInit,
    s.appState.isLinux,
    s.useInitElectronAppState,
  ]);

  initElectronAppState();
  useWatchThemeUpdate();

  const showWinControl = isAppStateInit && !isMac && !!isLinux;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={electronStylish.draggable}
      height={TITLE_BAR_HEIGHT}
      justify={showWinControl ? 'space-between' : 'center'}
      style={{ minHeight: TITLE_BAR_HEIGHT, padding: '0 12px' }}
      width={'100%'}
    >
      {showWinControl && <div style={{ width: WINDOW_CONTROL_WIDTH }} />}
      <ProductLogo size={16} type={'text'} />
      {showWinControl && <WinControl />}
    </Flexbox>
  );
};

export default SimpleTitleBar;
