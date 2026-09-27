import { Flexbox } from '@lobehub/ui';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import ActivityTable from './ActivityTable';
import { formatCpu, formatMemory, sumCpu, useActivities } from './state';

export default function BackgroundActivityPanel() {
  const { activities, sampledAt } = useActivities();
  const processes = activities.reduce((sum, row) => sum + row.processes.length, 0);
  return (
    <Flexbox className={devDockPanelStyles.root}>
      <ActivityTable />
      <div className={devDockPanelStyles.statusBar}>
        <span>
          {processes} proc · {formatMemory(activities.reduce((sum, row) => sum + row.memoryMB, 0))}{' '}
          · {formatCpu(sumCpu(activities))} cpu
        </span>
        {sampledAt > 0 && (
          <span>sampled {new Date(sampledAt).toLocaleTimeString()} · every 2s</span>
        )}
      </div>
    </Flexbox>
  );
}
