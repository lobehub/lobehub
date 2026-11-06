'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';
import {
  DEFAULT_LIVE_TAB_ROUTER_CAP,
  useLiveTabRouterCap,
} from '@/features/Electron/TabHost/liveTabRouterCap';
import { useElectronStore } from '@/store/electron';

import { type TabRouterRow, useTabRouterDebug } from './useTabRouterDebug';

const styles = stylex.create({
  cell: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  capInput: {
    inlineSize: '48px',
    marginInlineStart: '4px',
    paddingBlock: '0',
    paddingInline: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '4px',
    font: 'inherit',
    color: cssVar.colorText,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  cold: { color: cssVar.colorTextQuaternary },
  drift: { color: cssVar.colorWarning },
  empty: {
    padding: '24px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  head: {
    position: 'sticky',
    zIndex: 1,
    insetBlockStart: '0',
    color: cssVar.colorTextQuaternary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  legend: {
    flexShrink: 0,
    paddingBlockStart: '8px',
    paddingBlockEnd: '12px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '10px',
    lineHeight: 1.6,
    color: cssVar.colorTextQuaternary,
  },
  muted: { color: cssVar.colorTextTertiary },
  next: { color: cssVar.colorError },
  ok: { color: cssVar.colorSuccess },
  row: {
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: '24px 96px 68px 1fr 1fr 44px 76px 52px',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '5px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    fontFeatureSettings: "'tnum'",
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowActive: { backgroundColor: cssVar.colorFillTertiary, backgroundImage: 'none' },
  rows: { overflow: 'auto', flex: '1', minHeight: '0' },
  summary: {
    flexShrink: 0,
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
  },
});

const formatAge = (timestamp: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};

const Row = memo<{ index: number; nextEvicted: boolean; row: TabRouterRow }>(
  ({ index, nextEvicted, row }) => {
    const activateTab = useElectronStore((s) => s.activateTab);
    const state = row.active ? 'ACTIVE' : row.live ? 'LIVE' : 'COLD';

    return (
      <div
        {...stylex.props(styles.row, row.active && styles.rowActive)}
        role={'button'}
        tabIndex={0}
        onClick={() => activateTab(row.id)}
        onKeyDown={(e) => e.key === 'Enter' && activateTab(row.id)}
      >
        <span {...stylex.props(styles.muted)}>{index + 1}</span>
        <span {...stylex.props(styles.cell, styles.muted)} title={row.id}>
          {row.id}
        </span>
        <span {...stylex.props(row.live ? styles.ok : styles.cold)}>
          {state}
          {row.live !== row.shouldBeLive && '!'}
        </span>
        <span
          {...stylex.props(styles.cell)}
          title={row.title ? `${row.title} — ${row.storeUrl}` : row.storeUrl}
        >
          {row.storeUrl}
        </span>
        <span
          {...stylex.props(styles.cell, row.drift ? styles.drift : styles.muted)}
          title={row.routerUrl ?? 'router disposed'}
        >
          {row.live ? (row.drift ? row.routerUrl : '=') : '—'}
        </span>
        <span {...stylex.props(styles.muted)}>
          {row.canGoBack ? '◀' : '·'}
          {row.canGoForward ? '▶' : '·'}
        </span>
        <span {...stylex.props(styles.muted)}>{formatAge(row.lastVisited)}</span>
        <span {...stylex.props(nextEvicted ? styles.next : styles.muted)}>
          #{row.rank}
          {nextEvicted && '↓'}
        </span>
      </div>
    );
  },
);

Row.displayName = 'DevTabRoutersRow';

const TabRouters = memo(() => {
  const { cap, liveCount, orphanIds, rows, scopeKey } = useTabRouterDebug();
  const setCap = useLiveTabRouterCap((s) => s.setCap);

  const evictable = rows.filter((row) => row.live && !row.active);
  const nextEvictedId =
    liveCount >= cap && evictable.length > 0
      ? evictable.reduce((oldest, row) => (row.rank > oldest.rank ? row : oldest)).id
      : null;

  return (
    <Flexbox className={stylex.props(devDockPanelStyles.root).className}>
      <div {...stylex.props(styles.summary)}>
        scope <b>{scopeKey}</b> · tabs <b>{rows.length}</b> · live routers{' '}
        <b {...stylex.props(liveCount > cap ? styles.drift : undefined)}>
          {liveCount}/{cap}
        </b>{' '}
        · cap
        <input
          aria-label={'Live tab router cap'}
          {...stylex.props(styles.capInput)}
          min={1}
          step={1}
          title={`Default ${DEFAULT_LIVE_TAB_ROUTER_CAP}`}
          type={'number'}
          value={cap}
          onChange={(e) => setCap(e.target.valueAsNumber)}
        />
        {orphanIds.length > 0 && (
          <span {...stylex.props(styles.drift)}> · orphan routers {orphanIds.join(', ')}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div {...stylex.props(styles.empty)}>No tabs in this scope.</div>
      ) : (
        <div {...stylex.props(styles.rows)}>
          <div {...stylex.props(styles.row, styles.head)}>
            <span>#</span>
            <span>tab id</span>
            <span>state</span>
            <span>store url</span>
            <span>router url</span>
            <span>hist</span>
            <span>visited</span>
            <span>lru</span>
          </div>
          {rows.map((row, index) => (
            <Row index={index} key={row.id} nextEvicted={row.id === nextEvictedId} row={row} />
          ))}
        </div>
      )}
      <div {...stylex.props(styles.legend)}>
        ACTIVE / LIVE = keep-alive router in memory, COLD = disposed (next activation cold-starts).
        `!` marks a router whose liveness disagrees with the LRU plan. Router url shows `=` when it
        matches the store url, or the diverging location when a hidden tab navigated. `lru` is the
        recency rank; `↓` marks the router evicted next. Click a row to activate that tab.
      </div>
    </Flexbox>
  );
});

TabRouters.displayName = 'DevTabRouters';

export default TabRouters;
