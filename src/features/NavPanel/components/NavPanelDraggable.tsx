'use client';

import './NavPanelDraggable.css';

import { cssVar, DraggablePanel } from '@lobehub/ui';
import { cssVar as stylexCssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { Activity, memo, Suspense, useMemo, useRef } from 'react';

import NavPanelUpgradeEntry from '@/business/client/features/NavPanelUpgradeEntry';
import { isDesktop } from '@/const/version';
import { MAC_VIBRANCY_BACKGROUND } from '@/features/Electron/system/macWindowFullscreen';
import Footer from '@/features/HomeSidebar/Footer';
import { LIST_COLUMN_BACKGROUND } from '@/features/NavRail/const';
import { useImLayout } from '@/features/NavRail/useImLayout';
import { useGlobalStore } from '@/store/global';
import {
  NAV_PANEL_MAX_WIDTH,
  NAV_PANEL_MIN_WIDTH,
  systemStatusSelectors,
} from '@/store/global/selectors';
import { sx } from '@/styles/sx';
import { isMacOS } from '@/utils/platform';

import { useNavPanelSizeChangeHandler } from '../hooks/useNavPanel';

const draggableStyles = stylex.create({
  content: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: '100%',
    maxHeight: '100%',
  },
  inner: {
    position: 'relative',
    overflow: 'hidden',
    flex: '1',
    minWidth: '240px',
    maxWidth: '100%',
    minHeight: '0',
  },
  imPanel: {
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: stylexCssVar.colorBorderSecondary,
    backgroundColor: `color-mix(in srgb, ${stylexCssVar.colorBgContainer} 55%, ${stylexCssVar.colorBgLayout})`,
    backgroundImage: 'none',
  },
  layer: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minWidth: '240px',
    maxWidth: '100%',
    minHeight: '100%',
    maxHeight: '100%',
  },
  // The runtime `style` prop paints the real (vibrancy-aware) background on top.
  panel: {
    userSelect: 'none',
    height: '100%',
    color: stylexCssVar.colorTextSecondary,
    backgroundColor: stylexCssVar.colorBgLayout,
    backgroundImage: 'none',
  },
});

interface NavPanelDraggableProps {
  activeContent: {
    key: string;
    node: ReactNode;
  };
  homeContent?: ReactNode;
}

const classNames = {
  content: stylex.props(draggableStyles.content).className,
};

const hiddenLayerStyle = { display: 'none' };

export const NavPanelDraggable = memo<NavPanelDraggableProps>(({ activeContent, homeContent }) => {
  const [expand, togglePanel, isStatusInit] = useGlobalStore((s) => [
    systemStatusSelectors.showLeftPanel(s),
    s.toggleLeftPanel,
    systemStatusSelectors.isStatusInit(s),
  ]);
  const handleSizeChange = useNavPanelSizeChangeHandler();

  // Defer DraggablePanel mount until system status hydrates; otherwise defaultSize
  // captures the pre-hydration default and the DOM drifts off NavigationBar's live width.
  const defaultWidthRef = useRef(0);
  if (defaultWidthRef.current === 0 && isStatusInit) {
    defaultWidthRef.current = systemStatusSelectors.leftPanelWidth(useGlobalStore.getState());
  }

  const imLayout = useImLayout();
  const styles = useMemo(
    () => ({
      background: imLayout
        ? LIST_COLUMN_BACKGROUND
        : isDesktop && isMacOS()
          ? MAC_VIBRANCY_BACKGROUND
          : cssVar.colorBgLayout,
      zIndex: 11,
    }),
    [imLayout],
  );

  if (defaultWidthRef.current === 0) {
    const pendingWidth = systemStatusSelectors.leftPanelWidth(useGlobalStore.getState());
    return <div aria-hidden style={{ flexShrink: 0, height: '100%', width: pendingWidth }} />;
  }

  const defaultSize = { height: '100%', width: defaultWidthRef.current };
  const isHomeActive = activeContent.key === 'home';

  return (
    <DraggablePanel
      classNames={classNames}
      defaultSize={defaultSize}
      expand={expand}
      expandable={false}
      maxWidth={NAV_PANEL_MAX_WIDTH}
      minWidth={NAV_PANEL_MIN_WIDTH}
      placement="left"
      showBorder={false}
      style={styles}
      className={[
        stylex.props(draggableStyles.panel, imLayout && draggableStyles.imPanel).className,
        'lobe-nav-panel-draggable-4efd33c1-panel',
      ].join(' ')}
      onExpandChange={togglePanel}
      onSizeDragging={handleSizeChange}
    >
      <div {...stylex.props(draggableStyles.inner)}>
        {/* Home stays mounted while a route-owned panel is active so its list
            state survives the round trip. Activity keeps the fibers but not the
            visibility, so the layer is force-hidden like HomeLayout does. */}
        {homeContent && (
          <Activity mode={isHomeActive ? 'visible' : 'hidden'} name="NavPanelHome">
            <div
              {...sx(
                [draggableStyles.layer],
                undefined,
                isHomeActive ? undefined : hiddenLayerStyle,
              )}
            >
              {homeContent}
            </div>
          </Activity>
        )}
        {!isHomeActive && (
          <div {...stylex.props(draggableStyles.layer)} key={activeContent.key}>
            {activeContent.node}
          </div>
        )}
      </div>
      <Suspense fallback={null}>
        <NavPanelUpgradeEntry />
      </Suspense>
      {/* The rail owns settings and help under `im_layout`. */}
      {!imLayout && (
        <Suspense>
          <Footer />
        </Suspense>
      )}
    </DraggablePanel>
  );
});
