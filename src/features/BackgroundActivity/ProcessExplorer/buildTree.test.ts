import { describe, expect, it } from 'vitest';

import type { Activity } from '../state';
import { buildProcessTree, SECTION_APP, SECTION_BACKGROUND } from './buildTree';

const labels = {
  app: 'LobeHub',
  background: 'Background activity',
  conversation: 'Conversation',
  gpu: 'GPU',
  main: 'Main process',
  processCount: (count: number) => `${count} processes`,
  shared: 'Shared',
  utility: 'Utility',
  window: 'Window',
};

const activity = (
  rootId: string,
  topicId: string | undefined,
  cpu: number,
  names: string[],
): Activity => ({
  cpuPercent: cpu,
  label: rootId,
  memoryMB: 10,
  processes: names.map((name, index) => ({
    cpuPercent: index === 0 ? cpu : 0,
    id: `${rootId}:${index}`,
    memoryMB: 10 / names.length,
    name,
    pid: index + rootId.length * 100,
    ppid: index === 0 ? 1 : rootId.length * 100,
    rootId,
    topicId,
  })),
  rootId,
  severity: 'normal',
  topicId,
});

const build = (query = '') =>
  buildProcessTree({
    activities: [
      activity('unowned', undefined, 90, ['tail']),
      activity('slow', 't1', 1, ['sh', 'node']),
      activity('busy', 't1', 50, ['vite']),
    ],
    appProcesses: [
      { cpuPercent: 1, name: null, pid: 7, type: 'Browser', windowTitle: null, workingSetMB: 300 },
      {
        cpuPercent: 2,
        name: null,
        pid: 8,
        type: 'Tab',
        windowTitle: 'Refactor auth',
        workingSetMB: 400,
      },
    ],
    labels,
    query,
    sort: 'cpu',
    topicTitle: (id) => (id === 't1' ? 'Auth topic' : undefined),
    totalMemoryMB: 16_384,
  });

describe('buildProcessTree', () => {
  it('keeps unassigned processes last and orders the rest by the sort column', () => {
    const [background] = build().treeData;
    expect(background.children!.map((node) => node.key)).toEqual([
      'conversation:t1',
      'conversation:shared',
    ]);
    expect(background.children![0].children!.map((node) => node.key)).toEqual([
      'activity:busy',
      'activity:slow',
    ]);
  });

  it('names windows by their title and sums section totals', () => {
    const { rows } = build();
    expect(rows.get('app:8')).toMatchObject({ label: 'Refactor auth', sub: 'Window' });
    expect(rows.get('app:7')).toMatchObject({ label: 'LobeHub', sub: 'Main process' });
    expect(rows.get(SECTION_APP)).toMatchObject({ cpu: 3, memory: 700 });
    expect(rows.get(SECTION_BACKGROUND)).toMatchObject({ cpu: 141, memory: 30 });
  });

  it('filters by process name while keeping the matching branch and its ancestors', () => {
    const [background, app] = build('node').treeData;
    expect(background.children!.map((node) => node.key)).toEqual(['conversation:t1']);
    expect(background.children![0].children!.map((node) => node.key)).toEqual(['activity:slow']);
    expect(app.children).toBeUndefined();
  });
});
