'use client';

import { Freeze } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { AnimatePresence, m, useIsPresent } from 'motion/react';
import { type ReactNode } from 'react';
import { memo, useMemo, useRef } from 'react';

import RightPanel from '@/features/RightPanel';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import type { PanelSlideMotionDirection } from '@/utils/motion/panelSlideMotion';
import {
  isPanelLayerMotionDisabled,
  panelSlideMotionVariantsLeft,
} from '@/utils/motion/panelSlideMotion';

import Conversation from '../Copilot/Conversation';
import HistoryPanel from '../History';
import { selectors, usePageEditorStore } from '../store';

const styles = createStaticStyles(({ css }) => ({
  inner: css`
    position: relative;

    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    width: 100%;
    height: 100%;
    min-height: 0;
  `,
  layer: css`
    will-change: opacity, transform;

    position: absolute;
    inset: 0;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-height: 100%;
    max-height: 100%;
  `,
}));

const ExitingFrozenContent = memo<{ children: ReactNode }>(({ children }) => {
  const isPresent = useIsPresent();

  return <Freeze frozen={!isPresent}>{children}</Freeze>;
});

ExitingFrozenContent.displayName = 'PageEditorExitingFrozenContent';

const PageEditorRightPanelContent = memo(() => {
  const rightPanelMode = usePageEditorStore(selectors.rightPanelMode);
  const animationMode = useUserStore(userGeneralSettingsSelectors.animationMode);
  const shouldUseMotion = !isPanelLayerMotionDisabled(animationMode);

  const previousModeRef = useRef(rightPanelMode);
  const directionRef = useRef<PanelSlideMotionDirection>(0);

  if (previousModeRef.current !== rightPanelMode) {
    directionRef.current = rightPanelMode === 'history' ? 1 : -1;
    previousModeRef.current = rightPanelMode;
  }

  const activeContent = useMemo(
    () => ({
      key: rightPanelMode,
      node: rightPanelMode === 'history' ? <HistoryPanel /> : <Conversation />,
    }),
    [rightPanelMode],
  );

  if (!shouldUseMotion) {
    return <div className={styles.layer}>{activeContent.node}</div>;
  }

  return (
    <AnimatePresence custom={directionRef.current} initial={false} mode="sync">
      <m.div
        animate="animate"
        className={styles.layer}
        custom={directionRef.current}
        exit="exit"
        initial="initial"
        key={activeContent.key}
        transition={panelSlideMotionVariantsLeft.transition}
        variants={panelSlideMotionVariantsLeft}
      >
        <ExitingFrozenContent>{activeContent.node}</ExitingFrozenContent>
      </m.div>
    </AnimatePresence>
  );
});

PageEditorRightPanelContent.displayName = 'PageEditorRightPanelContent';

const PageEditorRightPanel = memo(() => {
  const [width, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.pageAgentPanelWidth(s),
    s.updateSystemStatus,
  ]);

  return (
    <RightPanel
      defaultWidth={width}
      onSizeChange={(size) => {
        if (size?.width) {
          const nextWidth =
            typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
          if (nextWidth) updateSystemStatus({ pageAgentPanelWidth: nextWidth });
        }
      }}
    >
      <div className={styles.inner}>
        <PageEditorRightPanelContent />
      </div>
    </RightPanel>
  );
});

PageEditorRightPanel.displayName = 'PageEditorRightPanel';

export default PageEditorRightPanel;
