'use client';

import { DraggablePanel, Freeze } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import  { type ReactNode } from 'react';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';

import { USER_DROPDOWN_ICON_ID } from '@/app/[variants]/(main)/home/_layout/Header/components/User';
import { isDesktop } from '@/const/version';
import { TOGGLE_BUTTON_ID } from '@/features/NavPanel/ToggleLeftPanelButton';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { isMacOS } from '@/utils/platform';

import { useNavPanelSizeChangeHandler } from '../hooks/useNavPanel';
import { BACK_BUTTON_ID } from './BackButton';

type MotionDirection = -1 | 0 | 1;

const MOTION_OFFSET = 8;

const isMotionDisabled = (mode?: string) => mode === 'disabled';

const getMotionDirectionByHistory = (history: string[], nextKey: string): MotionDirection => {
  const currentKey = history.at(-1);
  if (currentKey === nextKey) return 0;

  return history.includes(nextKey) ? -1 : 1;
};

const motionVariants = {
  animate: { opacity: 1, x: 0 },
  exit: (direction: MotionDirection) => ({
    opacity: 0,
    x: -direction * MOTION_OFFSET,
  }),
  initial: (direction: MotionDirection) => ({
    opacity: 0,
    x: direction * MOTION_OFFSET,
  }),
  transition: {
    duration: 0.28,
    ease: [0.4, 0, 0.2, 1],
  },
} as const;

const draggableStyles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    position: relative;

    overflow: hidden;
    display: flex;

    height: 100%;
    min-height: 100%;
    max-height: 100%;
  `,
  inner: css`
    position: relative;

    overflow: hidden;
    flex: 1;

    min-width: 240px;
    max-width: 100%;
    min-height: 100%;
    max-height: 100%;
  `,
  layer: css`
    will-change: opacity, transform;

    position: absolute;
    inset: 0;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 240px;
    max-width: 100%;
    min-height: 100%;
    max-height: 100%;
  `,
  panel: css`
    user-select: none;
    height: 100%;
    color: ${cssVar.colorTextSecondary};
    background: ${isDesktop && isMacOS() ? 'transparent' : cssVar.colorBgLayout};

    * {
      user-select: none;
    }

    #${TOGGLE_BUTTON_ID} {
      width: 0 !important;
      opacity: 0;
      transition:
        opacity,
        width 0.2s ${cssVar.motionEaseOut};
    }

    #${USER_DROPDOWN_ICON_ID} {
      width: 0 !important;
      opacity: 0;
      transition:
        opacity,
        width 0.2s ${cssVar.motionEaseOut};
    }
    #${BACK_BUTTON_ID} {
      width: 24px !important;
    }

    &:hover {
      #${TOGGLE_BUTTON_ID} {
        width: 32px !important;
        opacity: 1;
      }

      #${USER_DROPDOWN_ICON_ID} {
        width: 14px !important;
        opacity: 1;
      }
    }
  `,
}));

interface NavPanelDraggableProps {
  activeContent: {
    key: string;
    node: ReactNode;
  };
}

interface ExitingFrozenContentProps {
  children: ReactNode;
}

const classNames = {
  content: draggableStyles.content,
};

const ExitingFrozenContent = memo<ExitingFrozenContentProps>(({ children }) => {
  const isPresent = useIsPresent();

  return <Freeze frozen={!isPresent}>{children}</Freeze>;
});

ExitingFrozenContent.displayName = 'ExitingFrozenContent';

export const NavPanelDraggable = memo<NavPanelDraggableProps>(({ activeContent }) => {
  const [expand, togglePanel] = useGlobalStore((s) => [
    systemStatusSelectors.showLeftPanel(s),
    s.toggleLeftPanel,
  ]);
  const animationMode = useUserStore(userGeneralSettingsSelectors.animationMode);
  const shouldUseMotion = !isMotionDisabled(animationMode);
  const handleSizeChange = useNavPanelSizeChangeHandler();

  const defaultWidthRef = useRef(0);
  if (defaultWidthRef.current === 0) {
    defaultWidthRef.current = systemStatusSelectors.leftPanelWidth(useGlobalStore.getState());
  }

  const defaultSize = useMemo(
    () => ({
      height: '100%',
      width: defaultWidthRef.current,
    }),
    [],
  );
  const styles = useMemo(
    () => ({
      background: isDesktop && isMacOS() ? 'transparent' : cssVar.colorBgLayout,
      zIndex: 11,
    }),
    [],
  );

  const historyRef = useRef([activeContent.key]);
  const directionRef = useRef<MotionDirection>(0);

  const history = historyRef.current;
  const direction = shouldUseMotion ? getMotionDirectionByHistory(history, activeContent.key) : 0;
  if (direction !== 0) {
    directionRef.current = direction;
  }

  useLayoutEffect(() => {
    if (!shouldUseMotion) return;

    const snapshot = historyRef.current;
    const currentKey = snapshot.at(-1);
    const nextKey = activeContent.key;

    if (currentKey === nextKey) return;

    const existingIndex = snapshot.lastIndexOf(nextKey);
    if (existingIndex !== -1) {
      snapshot.splice(existingIndex + 1);
      return;
    }

    snapshot.push(nextKey);
  }, [activeContent.key, shouldUseMotion]);

  const motionDirection = shouldUseMotion ? directionRef.current : 0;

  return (
    <DraggablePanel
      className={draggableStyles.panel}
      classNames={classNames}
      defaultSize={defaultSize}
      expand={expand}
      expandable={false}
      maxWidth={400}
      minWidth={240}
      placement="left"
      showBorder={false}
      style={styles}
      onExpandChange={togglePanel}
      onSizeDragging={handleSizeChange}
    >
      <div className={draggableStyles.inner}>
        {shouldUseMotion ? (
          <AnimatePresence custom={motionDirection} initial={false} mode="sync">
            <motion.div
              animate="animate"
              className={draggableStyles.layer}
              custom={motionDirection}
              exit="exit"
              initial="initial"
              key={activeContent.key}
              transition={motionVariants.transition}
              variants={motionVariants}
            >
              <ExitingFrozenContent>{activeContent.node}</ExitingFrozenContent>
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className={draggableStyles.layer} key={activeContent.key}>
            {activeContent.node}
          </div>
        )}
      </div>
    </DraggablePanel>
  );
});
