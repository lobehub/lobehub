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
const slotStyle: CSSProperties = { inset: 0, position: 'absolute' };
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
  const focusTabPane = useElectronStore((s) => s.focusTabPane);
  const setSplitRatio = useElectronStore((s) => s.setSplitRatio);

  const visibleTabIds = useMemo(
    () =>
      splitView
        ? [splitView.primaryTabId, splitView.secondaryTabId]
        : activeTabId
          ? [activeTabId]
          : [],
    [activeTabId, splitView],
  );

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
    if (!splitView) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setSplitRatio(splitView.ratio + (event.key === 'ArrowLeft' ? -0.05 : 0.05));
  };

  return (
    <div style={rootStyle}>
      {tabs
        .filter((tab) => liveSet.has(tab.id))
        .map((tab) => {
          const isVisible = visibleSet.has(tab.id);
          const isPrimary = splitView?.primaryTabId === tab.id;
          const paneStyle: CSSProperties = splitView
            ? isPrimary
              ? { ...slotStyle, right: 'auto', width: `${splitView.ratio * 100}%` }
              : { ...slotStyle, left: 'auto', width: `${(1 - splitView.ratio) * 100}%` }
            : slotStyle;

          return (
            <Activity key={tab.id} mode={isVisible ? 'visible' : 'hidden'} name={`Tab:${tab.id}`}>
              {/* Activity preserves state but doesn't visually hide the DOM in this React
                version, so force-hide the inactive slot (mirrors home/_layout). */}
              <div
                className={styles.pane}
                data-focused={tab.id === activeTabId ? 'true' : undefined}
                data-pane={splitView ? (isPrimary ? 'primary' : 'secondary') : 'single'}
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
      {splitView && (
        <div
          aria-label={t('tab.resizeSplitView')}
          aria-orientation="vertical"
          aria-valuemax={75}
          aria-valuemin={25}
          aria-valuenow={Math.round(splitView.ratio * 100)}
          className={styles.divider}
          role="separator"
          style={{ left: `${splitView.ratio * 100}%` }}
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
