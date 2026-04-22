import type { ScreenCaptureWindowInfo } from '@lobechat/electron-client-ipc';
import { memo } from 'react';

import { OVERLAY_LAYOUT } from './constants';
import * as styles from './overlay.css.ts';

interface WindowTagProps {
  viewportWidth: number;
  window: ScreenCaptureWindowInfo;
}

const WindowTag = memo<WindowTagProps>(({ viewportWidth, window: win }) => {
  const { width, x, y } = win.overlayBounds;
  const maxWidth = Math.min(
    Math.max(width - OVERLAY_LAYOUT.windowTagHorizontalInset * 2, 0),
    OVERLAY_LAYOUT.windowTagMaxWidth,
  );
  const left = Math.min(
    Math.max(x + OVERLAY_LAYOUT.windowTagHorizontalInset, OVERLAY_LAYOUT.windowTagHorizontalInset),
    Math.max(
      viewportWidth - maxWidth - OVERLAY_LAYOUT.windowTagHorizontalInset,
      OVERLAY_LAYOUT.windowTagHorizontalInset,
    ),
  );

  return (
    <div
      className={styles.windowTag}
      style={{
        left,
        maxWidth,
        top: Math.max(y + OVERLAY_LAYOUT.windowTagTopOffset, OVERLAY_LAYOUT.windowTagTopOffset),
      }}
    >
      <span className={styles.windowTagApp}>{win.appName}</span>
      {win.title && <span className={styles.windowTagDivider}>•</span>}
      {win.title && <span className={styles.windowTagTitle}>{win.title}</span>}
    </div>
  );
});

WindowTag.displayName = 'WindowTag';

export default WindowTag;
