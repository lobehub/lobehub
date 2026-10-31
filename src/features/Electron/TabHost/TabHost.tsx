'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Activity,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { UNSAFE_LocationContext } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { createTabRouter } from '@/spa/router/tabRouter';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';
import { sx } from '@/styles/sx';

import { useDisplayedTabStore } from './displayedTab';
import { flushHiddenTabRestores } from './hiddenTabRestore';
import { useLiveTabRouterCap } from './liveTabRouterCap';
import { resolveLiveTabIds } from './resolveLiveTabIds';
import { TabIdContext } from './TabIdContext';
import {
  getOrCreateTabRouter,
  getTabRouter,
  getTabRouterIds,
  syncTabRouters,
  type TabRouter,
} from './tabRouterManager';
import { useDisplayedTabIds } from './useDisplayedTabIds';
import { useTabPreviewCapture } from './useTabPreviewCapture';

interface TabHostProps {
  createRouter?: (url: string) => TabRouter;
}

const rootStyle: CSSProperties = { blockSize: '100%', inlineSize: '100%', position: 'relative' };
// Longhands only — no `inset` shorthand. The split styles override `left`/`right`
// per pane, and React's style diff never re-applies an unchanged shorthand, so a
// pane leaving the split would keep `right` removed (not restored to 0) and
// collapse to zero width.
const slotStyle: CSSProperties = {
  bottom: 0,
  left: 0,
  position: 'absolute',
  right: 0,
  top: 0,
  width: 'auto',
};
const hiddenSlotStyle: CSSProperties = { ...slotStyle, display: 'none' };

const styles = stylex.create({
  divider: {
    'cursor': 'col-resize',
    'position': 'absolute',
    'zIndex': 10,
    'insetBlock': 0,
    'transform': 'translateX(-50%)',
    'width': '8px',
    '::after': {
      content: "''",
      position: 'absolute',
      insetBlock: 0,
      insetInlineStart: '50%',
      transform: 'translateX(-50%)',
      width: { 'default': '1px', ':hover': '2px', ':focus-visible': '2px' },
      backgroundColor: {
        'default': cssVar.colorBorderSecondary,
        ':hover': cssVar.colorPrimary,
        ':focus-visible': cssVar.colorPrimary,
      },
      transitionProperty: 'background-color, width',
      transitionDuration: '150ms',
      transitionTimingFunction: 'ease',
    },
  },
  pane: { overflow: 'hidden', minWidth: 0 },
});

interface TabPaneProps {
  children: ReactNode;
  isActive: boolean;
  isVisible: boolean;
  onFocusPane: () => void;
  pane: 'primary' | 'secondary' | 'single';
  style: CSSProperties;
  tabId: string;
}

const TabPane = ({
  children,
  isActive,
  isVisible,
  onFocusPane,
  pane,
  style,
  tabId,
}: TabPaneProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useTabPreviewCapture(tabId, isVisible, ref);

  return (
    <div
      {...sx([styles.pane], undefined, style)}
      data-focused={isActive ? 'true' : undefined}
      data-pane={pane}
      ref={ref}
      onFocusCapture={onFocusPane}
      onPointerDownCapture={onFocusPane}
    >
      {children}
    </div>
  );
};

const TabHost = ({ createRouter = createTabRouter }: TabHostProps) => {
  const { t } = useTranslation('electron');
  // Deferred so the strip commits a tab switch before the pane does. Activating a cold
  // tab mounts its whole router tree; on the urgent lane that mount lands in the same
  // commit as the strip update, so closing a tab froze mid-spring until the neighbour
  // finished rendering. As a transition it is time-sliced and, when the page suspends on
  // a lazy chunk, the outgoing pane stays on screen instead of flashing a fallback.
  const tabs = useDeferredValue(useElectronStore((s) => s.tabs));
  const activeTabId = useDeferredValue(useElectronStore((s) => s.activeTabId));
  const splitView = useDeferredValue(useElectronStore((s) => s.splitView));
  const isPreferenceInit = useUserStore(preferenceSelectors.isPreferenceInit);
  const splitViewEnabled = useUserStore(labPreferSelectors.enableDesktopSplitView);
  const closeSplitView = useElectronStore((s) => s.closeSplitView);
  const focusTabPane = useElectronStore((s) => s.focusTabPane);
  const setSplitRatio = useElectronStore((s) => s.setSplitRatio);
  const effectiveSplitView = isPreferenceInit && splitViewEnabled ? splitView : null;
  const liveTabCap = useLiveTabRouterCap((s) => s.cap);

  const visibleTabIds = useMemo(
    () =>
      effectiveSplitView
        ? [effectiveSplitView.primaryTabId, effectiveSplitView.secondaryTabId]
        : activeTabId
          ? [activeTabId]
          : [],
    [activeTabId, effectiveSplitView],
  );

  const existingTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const requestedRouters = useMemo(
    () =>
      visibleTabIds.flatMap((id) => {
        const tab = tabs.find((item) => item.id === id);
        return tab ? [getOrCreateTabRouter(id, tab.url, createRouter)] : [];
      }),
    [createRouter, tabs, visibleTabIds],
  );
  const displayedTabIds = useDisplayedTabIds({
    canHold: !effectiveSplitView,
    existingTabIds,
    requestedRouters,
    requestedTabIds: visibleTabIds,
  });

  useEffect(() => {
    if (isPreferenceInit && !splitViewEnabled && splitView) closeSplitView();
  }, [closeSplitView, isPreferenceInit, splitView, splitViewEnabled]);

  const liveIds = useMemo(() => {
    const retainedTabIds = [...visibleTabIds, ...displayedTabIds];
    return resolveLiveTabIds(
      // Persisted tabs are cold until first shown; only retain already-created routers.
      tabs.filter((tab) => retainedTabIds.includes(tab.id) || getTabRouter(tab.id)),
      activeTabId,
      liveTabCap,
      retainedTabIds,
    );
  }, [tabs, activeTabId, liveTabCap, visibleTabIds, displayedTabIds]);

  const displayedActiveTabId =
    activeTabId && displayedTabIds.includes(activeTabId)
      ? activeTabId
      : (displayedTabIds[0] ?? null);

  useLayoutEffect(() => {
    useDisplayedTabStore.setState({ tabId: displayedActiveTabId });
  }, [displayedActiveTabId]);

  useEffect(() => {
    flushHiddenTabRestores(displayedTabIds);
  }, [displayedTabIds]);

  useEffect(() => {
    const liveSet = new Set(liveIds);
    const { snapshotTabLocation } = useElectronStore.getState();
    for (const id of getTabRouterIds()) {
      if (liveSet.has(id)) continue;
      const location = getTabRouter(id)?.state.location;
      if (location)
        snapshotTabLocation(id, `${location.pathname}${location.search}${location.hash}`);
    }
    syncTabRouters(liveIds);
  }, [liveIds]);

  const liveSet = new Set(liveIds);
  const visibleSet = new Set(displayedTabIds);
  // A held tab must not pre-mount: a hidden RouterProvider has no subscription,
  // so it would reveal its pre-load (empty) state once the router initializes.
  const heldSet = new Set(visibleTabIds.filter((id) => !visibleSet.has(id)));

  const handleDividerPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds?.width) return;
    setSplitRatio((event.clientX - bounds.left) / bounds.width);
  };

  const handleDividerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!effectiveSplitView) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setSplitRatio(effectiveSplitView.ratio + (event.key === 'ArrowLeft' ? -0.05 : 0.05));
  };

  return (
    <div style={rootStyle}>
      {tabs
        .filter((tab) => liveSet.has(tab.id) && !heldSet.has(tab.id))
        .map((tab) => {
          const isVisible = visibleSet.has(tab.id);
          const isPrimary = effectiveSplitView?.primaryTabId === tab.id;
          const paneStyle: CSSProperties = effectiveSplitView
            ? isPrimary
              ? { ...slotStyle, right: 'auto', width: `${effectiveSplitView.ratio * 100}%` }
              : {
                  ...slotStyle,
                  left: 'auto',
                  width: `${(1 - effectiveSplitView.ratio) * 100}%`,
                }
            : slotStyle;

          return (
            <Activity key={tab.id} mode={isVisible ? 'visible' : 'hidden'} name={`Tab:${tab.id}`}>
              {/* Activity preserves state but doesn't visually hide the DOM in this React
                version, so force-hide the inactive slot (mirrors home/_layout). */}
              <TabPane
                isActive={tab.id === activeTabId}
                isVisible={isVisible}
                pane={effectiveSplitView ? (isPrimary ? 'primary' : 'secondary') : 'single'}
                style={isVisible ? paneStyle : hiddenSlotStyle}
                tabId={tab.id}
                onFocusPane={() => focusTabPane(tab.id)}
              >
                <TabIdContext value={tab.id}>
                  {/* react-router forbids a data <RouterProvider> inside another Router
                      (useInRouterContext invariant). Reset LocationContext so each per-tab
                      router mounts as a root; nothing renders between the reset and the
                      provider, so no consumer can observe the null gap. */}
                  <UNSAFE_LocationContext value={null as never}>
                    <RouterProvider router={getOrCreateTabRouter(tab.id, tab.url, createRouter)} />
                  </UNSAFE_LocationContext>
                </TabIdContext>
              </TabPane>
            </Activity>
          );
        })}
      {effectiveSplitView && (
        <div
          aria-label={t('tab.resizeSplitView')}
          aria-orientation="vertical"
          aria-valuemax={75}
          aria-valuemin={25}
          aria-valuenow={Math.round(effectiveSplitView.ratio * 100)}
          role="separator"
          {...sx([styles.divider], undefined, { left: `${effectiveSplitView.ratio * 100}%` })}
          tabIndex={0}
          onDoubleClick={() => setSplitRatio(0.5)}
          onKeyDown={handleDividerKeyDown}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={handleDividerPointerMove}
        />
      )}
    </div>
  );
};

export default TabHost;
