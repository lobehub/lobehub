'use client';

import type { AcceptanceFrameVersion } from '@lobechat/types';
import * as stylex from '@stylexjs/stylex';

import CanvasFrame from '@/features/Conversation/WorkingSidebar/Canvas/CanvasFrame';

const styles = stylex.create({
  viewport: {
    display: 'flex',
    flexDirection: 'column',
    height: 520,
    lineHeight: 'normal',
    width: '100%',
  },
});

/**
 * A version's reference, live: the pinned Canvas page itself, clickable the
 * way the shipped UI will be. Fixed height, so pins dropped on it keep their
 * place between visits.
 */
const CanvasReference = ({ version }: { version: AcceptanceFrameVersion }) => (
  <div {...stylex.props(styles.viewport)}>
    <CanvasFrame
      canvasId={version.canvasId}
      key={`${version.canvasId}@${version.canvasVersion}#${version.page ?? ''}`}
      page={version.page}
      version={version.canvasVersion}
    />
  </div>
);

export default CanvasReference;
