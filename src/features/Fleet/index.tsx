'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useEffect } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';

import ColumnsBoard from './ColumnsBoard';
import RunningTaskSidebar from './RunningTaskSidebar';
import { useFleetStore } from './store';
import { useRunningTasks } from './useRunningTasks';

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

  const { columns, isInit, taskByColumnKey } = useRunningTasks();
  const seedColumns = useFleetStore((s) => s.seedColumns);

  // Default: show all currently-running topics, one column each. Seeds once
  // per app load (the store re-seeds on reload since columns aren't persisted).
  useEffect(() => {
    if (isInit) seedColumns(columns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInit]);

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <RunningTaskSidebar columns={columns} taskByColumnKey={taskByColumnKey} />
      <ColumnsBoard runningColumns={columns} taskByColumnKey={taskByColumnKey} />
    </Flexbox>
  );
});

FleetView.displayName = 'FleetView';

export default FleetView;
