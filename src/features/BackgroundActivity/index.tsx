import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import ActivityTable from './ActivityTable';
import { formatCpu, formatMemory, sumCpu, useActivities } from './state';

export default function BackgroundActivityPanel() {
  const { activities, sampledAt } = useActivities();
  const processes = activities.reduce((sum, row) => sum + row.processes.length, 0);
  return (
    <Flexbox className={stylex.props(devDockPanelStyles.root).className}>
      <Flexbox flex={1} style={{ minHeight: 0, overflow: 'auto' }}>
        <ActivityTable />
      </Flexbox>
      <div {...stylex.props(devDockPanelStyles.statusBar)}>
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
