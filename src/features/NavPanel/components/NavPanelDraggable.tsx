'use client';

import { DraggablePanel } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, memo, useMemo, useRef } from 'react';

import { USER_DROPDOWN_ICON_ID } from '@/app/[variants]/(main)/home/_layout/Header/components/User';
import { isDesktop } from '@/const/version';
import { TOGGLE_BUTTON_ID } from '@/features/NavPanel/ToggleLeftPanelButton';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isMacOS } from '@/utils/platform';

import { useNavPanelSizeChangeHandler } from '../hooks/useNavPanel';
import { BACK_BUTTON_ID } from './BackButton';

const motionVariants = {
  animate: { opacity: 1, x: 0 },
  exit: {
    opacity: 0,
    x: '-20%',
  },
  initial: {
    opacity: 0,
    x: 0,
  },
  transition: {
    duration: 0.4,
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
    inset: 0;

    overflow: hidden;
    flex: 1;
    flex-direction: column;

    min-width: 240px;
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
      width: 0 !important;
      opacity: 0;
      transition: all 0.2s ${cssVar.motionEaseOut};
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

      &:hover {
        #${BACK_BUTTON_ID} {
          width: 24px !important;
          opacity: 1;
        }
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

const classNames = {
  content: draggableStyles.content,
};

export const NavPanelDraggable = memo<NavPanelDraggableProps>(({ activeContent }) => {
  const [expand, togglePanel] = useGlobalStore((s) => [
    systemStatusSelectors.showLeftPanel(s),
    s.toggleLeftPanel,
  ]);
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
    [defaultWidthRef.current],
  );
  const styles = useMemo(
    () => ({
      background: isDesktop && isMacOS() ? 'transparent' : cssVar.colorBgLayout,
      zIndex: 11,
    }),
    [isDesktop, isMacOS()],
  );
  return (
    <DraggablePanel
      className={draggableStyles.panel}
      classNames={classNames}
      defaultSize={defaultSize}
      expand={expand}
      expandable={false}
      maxWidth={400}
      minWidth={240}
      onExpandChange={togglePanel}
      onSizeDragging={handleSizeChange}
      placement="left"
      showBorder={false}
      style={styles}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          animate={motionVariants.animate}
          className={draggableStyles.inner}
          exit={motionVariants.exit}
          initial={motionVariants.initial}
          key={activeContent.key}
          transition={motionVariants.transition}
        >
          {activeContent.node}
        </motion.div>
      </AnimatePresence>
    </DraggablePanel>
  );
});
