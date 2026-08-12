'use client';

import { createStaticStyles } from 'antd-style';
import {
  Activity,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { UNSAFE_LocationContext } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { createTabRouter } from '@/spa/router/tabRouter';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

import { MAX_LIVE_TAB_ROUTERS, resolveLiveTabIds } from './resolveLiveTabIds';
import { TabIdContext } from './TabIdContext';
import {
  getOrCreateTabRouter,
  getTabRouter,
  getTabRouterIds,
  syncTabRouters,
  type TabRouter,
} from './tabRouterManager';

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

const styles = createStaticStyles(({ css, cssVar }) => ({
  divider: css`
    cursor: col-resize;

    position: absolute;
    z-index: 10;
    inset-block: 0;
    transform: translateX(-50%);

    width: 8px;

    &::after {
      content: '';

      position: absolute;
      inset-block: 0;
      inset-inline-start: 50%;
      transform: translateX(-50%);

      width: 1px;

      background: ${cssVar.colorBorderSecondary};

      transition:
        background 150ms ease,
        width 150ms ease;
    }

    &:hover::after,
    &:focus-visible::after {
      width: 2px;
      background: ${cssVar.colorPrimary};
    }
  `,
  pane: css`
    overflow: hidden;
    min-width: 0;
  `,
}));

const TabHost = ({ createRouter = createTabRouter }: TabHostProps) => {
  const { t } = useTranslation('electron');
  const tabs = useElectronStore((s) => s.tabs);
  const activeTabId = useElectronStore((s) => s.activeTabId);
  const splitView = useElectronStore((s) => s.splitView);
  const isPreferenceInit = useUserStore(preferenceSelectors.isPreferenceInit);
  const splitViewEnabled = useUserStore(labPreferSelectors.enableDesktopSplitView);
  const closeSplitView = useElectronStore((s) => s.closeSplitView);
  const focusTabPane = useElectronStore((s) => s.focusTabPane);
  const setSplitRatio = useElectronStore((s) => s.setSplitRatio);
  const effectiveSplitView = isPreferenceInit && splitViewEnabled ? splitView : null;

  const visibleTabIds = useMemo(
    () =>
      effectiveSplitView
        ? [effectiveSplitView.primaryTabId, effectiveSplitView.secondaryTabId]
        : activeTabId
          ? [activeTabId]
          : [],
    [activeTabId, effectiveSplitView],
  );

  useEffect(() => {
    if (isPreferenceInit && !splitViewEnabled && splitView) closeSplitView();
  }, [closeSplitView, isPreferenceInit, splitView, splitViewEnabled]);

  const liveIds = useMemo(
    () => resolveLiveTabIds(tabs, activeTabId, MAX_LIVE_TAB_ROUTERS, visibleTabIds),
    [tabs, activeTabId, visibleTabIds],
  );

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
  const visibleSet = new Set(visibleTabIds);

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
        .filter((tab) => liveSet.has(tab.id))
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
              <div
                className={styles.pane}
                data-focused={tab.id === activeTabId ? 'true' : undefined}
                data-pane={effectiveSplitView ? (isPrimary ? 'primary' : 'secondary') : 'single'}
                style={isVisible ? paneStyle : hiddenSlotStyle}
                onFocusCapture={() => focusTabPane(tab.id)}
                onPointerDownCapture={() => focusTabPane(tab.id)}
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
              </div>
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
          className={styles.divider}
          role="separator"
          style={{ left: `${effectiveSplitView.ratio * 100}%` }}
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
