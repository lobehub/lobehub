'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useRef } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';

import ColumnsBoard from './ColumnsBoard';
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

  const { columns, isInit, statusByColumnKey } = useRunningTopics();
  const addColumn = useFleetStore((s) => s.addColumn);

  // Desktop tabs are in-SPA navigations, so opening this tab remounts the view.
  // On each open we sync the board to the live running set: every running topic
  // gets a column (addColumn is idempotent, so manually-added and reordered
  // columns are preserved). We auto-sync each key at most once per mount, so a
  // column you close mid-session stays closed, while a topic that *starts*
  // running while you watch still pops in.
  const syncedKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isInit) return;
    for (const column of columns) {
      if (syncedKeys.current.has(column.key)) continue;
      syncedKeys.current.add(column.key);
      addColumn(column);
    }
  }, [isInit, columns, addColumn]);

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <RunningTaskSidebar columns={columns} statusByColumnKey={statusByColumnKey} />
      <ColumnsBoard statusByColumnKey={statusByColumnKey} />
    </Flexbox>
  );
});

FleetView.displayName = 'FleetView';

export default FleetView;
