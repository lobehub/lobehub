'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';
import { useElectronStore } from '@/store/electron';

import { type TabRouterRow, useTabRouterDebug } from './useTabRouterDebug';

const styles = createStaticStyles(({ css }) => ({
  cell: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  cold: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  drift: css`
    color: ${cssVar.colorWarning};
  `,
  empty: css`
    padding: 24px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  head: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.04em;

    background: ${cssVar.colorBgContainer};
  `,
  legend: css`
    flex-shrink: 0;

    padding-block: 8px 12px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 10px;
    line-height: 1.6;
    color: ${cssVar.colorTextQuaternary};
  `,
  muted: css`
    color: ${cssVar.colorTextTertiary};
  `,
  next: css`
    color: ${cssVar.colorError};
  `,
  ok: css`
    color: ${cssVar.colorSuccess};
  `,
  row: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 24px 96px 68px 1fr 1fr 44px 76px 52px;
    gap: 8px;
    align-items: center;

    padding-block: 5px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-feature-settings: 'tnum';

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  rowActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  rows: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
  `,
  summary: css`
    flex-shrink: 0;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

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
        className={cx(styles.row, row.active && styles.rowActive)}
        role={'button'}
        tabIndex={0}
        onClick={() => activateTab(row.id)}
        onKeyDown={(e) => e.key === 'Enter' && activateTab(row.id)}
      >
        <span className={styles.muted}>{index + 1}</span>
        <span className={cx(styles.cell, styles.muted)} title={row.id}>
          {row.id}
        </span>
        <span className={row.live ? styles.ok : styles.cold}>
          {state}
          {row.live !== row.shouldBeLive && '!'}
        </span>
        <span
          className={styles.cell}
          title={row.title ? `${row.title} — ${row.storeUrl}` : row.storeUrl}
        >
          {row.storeUrl}
        </span>
        <span
          className={cx(styles.cell, row.drift ? styles.drift : styles.muted)}
          title={row.routerUrl ?? 'router disposed'}
        >
          {row.live ? (row.drift ? row.routerUrl : '=') : '—'}
        </span>
        <span className={styles.muted}>
          {row.canGoBack ? '◀' : '·'}
          {row.canGoForward ? '▶' : '·'}
        </span>
        <span className={styles.muted}>{formatAge(row.lastVisited)}</span>
        <span className={nextEvicted ? styles.next : styles.muted}>
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

  const evictable = rows.filter((row) => row.live && !row.active);
  const nextEvictedId =
    liveCount >= cap && evictable.length > 0
      ? evictable.reduce((oldest, row) => (row.rank > oldest.rank ? row : oldest)).id
      : null;

  return (
    <Flexbox className={devDockPanelStyles.root}>
      <div className={styles.summary}>
        scope <b>{scopeKey}</b> · tabs <b>{rows.length}</b> · live routers{' '}
        <b className={liveCount > cap ? styles.drift : undefined}>
          {liveCount}/{cap}
        </b>
        {orphanIds.length > 0 && (
          <span className={styles.drift}> · orphan routers {orphanIds.join(', ')}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className={styles.empty}>No tabs in this scope.</div>
      ) : (
        <div className={styles.rows}>
          <div className={cx(styles.row, styles.head)}>
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
      <div className={styles.legend}>
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
