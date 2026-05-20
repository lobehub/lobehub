'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { useWatchThemeUpdate } from '@/features/Electron/system/useWatchThemeUpdate';
import { WINDOWS_NATIVE_CONTROL_WIDTH } from '@/features/Electron/titlebar/layout';
import WinControl from '@/features/Electron/titlebar/WinControl';
import { electronStylish } from '@/styles/electron';
import { getPlatform, isMacOS } from '@/utils/platform';

import PinOnTopButton from './PinOnTopButton';

// Reserve space for macOS traffic lights when titleBarStyle is hidden.
const MAC_TRAFFIC_LIGHT_WIDTH = 80;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    user-select: none;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgLayout};
  `,
  title: css`
    overflow: hidden;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface PopupTitleBarProps {
  title?: string;
}

const PopupTitleBar = memo<PopupTitleBarProps>(({ title }) => {
  useWatchThemeUpdate();

  const platform = getPlatform();
  const isMac = isMacOS();
  const isLinux = platform === 'Linux';
  const isWindows = platform === 'Windows';
  const showWinControl = !isMac && isLinux;
  const leftSpacer = isMac ? MAC_TRAFFIC_LIGHT_WIDTH : 0;
  const rightSpacer = isWindows ? WINDOWS_NATIVE_CONTROL_WIDTH : 0;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.container, electronStylish.draggable)}
      flex={'none'}
      gap={4}
      height={TITLE_BAR_HEIGHT}
      style={{ minHeight: TITLE_BAR_HEIGHT, paddingInline: 8 }}
      width={'100%'}
    >
      <div style={{ flex: `0 0 ${leftSpacer}px` }} />
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        {title && <div className={styles.title}>{title}</div>}
      </Flexbox>
      <PinOnTopButton />
      {showWinControl ? <WinControl /> : <div style={{ flex: `0 0 ${rightSpacer}px` }} />}
    </Flexbox>
  );
});

PopupTitleBar.displayName = 'PopupTitleBar';

export default PopupTitleBar;
