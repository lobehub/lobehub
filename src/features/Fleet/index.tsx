'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useEffect } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';

import ColumnsBoard from './ColumnsBoard';
import FleetPanelCollapseSync from './FleetPanelCollapseSync';
import RunningTaskSidebar from './RunningTaskSidebar';
import { useFleetStore } from './store';
import { useRunningTopics } from './useRunningTopics';

/**
 * FleetView — a side-by-side dashboard of running agent tasks. The running-task
 * list is portaled into the global NavPanel (replacing the standard nav rail),
 * and the main area lays each task out as an independently-scrollable, resizable,
 * reorderable conversation column.
 */
const FleetView = memo(() => {
  // Eagerly load the sidebar agent list so each column resolves its agent meta
  // (avatar/title) — otherwise a fresh entry shows the default-assistant fallback.
  useFetchAgentList();

  const { columns, error, isInit, reload, statusByColumnKey } = useRunningTopics();
  const syncRunningColumns = useFleetStore((s) => s.syncRunningColumns);

  // Reconcile the live running set into the board whenever it changes (initial
  // load, focus refetch, a topic starting/stopping). The store appends only —
  // new running topics pop in, columns you've pinned or closed are untouched,
  // and a column you closed while it's still running won't immediately re-add.
  useEffect(() => {
    if (!isInit) return;
    syncRunningColumns(columns);
  }, [isInit, columns, syncRunningColumns]);

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <FleetPanelCollapseSync />
      <RunningTaskSidebar
        columns={columns}
        error={error}
        isLoading={!isInit}
        statusByColumnKey={statusByColumnKey}
        onReload={() => reload()}
      />
      <ColumnsBoard statusByColumnKey={statusByColumnKey} />
    </Flexbox>
  );
});

FleetView.displayName = 'FleetView';

export default FleetView;
