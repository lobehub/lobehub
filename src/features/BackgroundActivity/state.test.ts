import { describe, expect, it, vi } from 'vitest';

import {
  formatMemory,
  groupActivities,
  type ProcessRow,
  type ProcessSnapshot,
  processTree,
  ResourceAlerts,
} from './state';

vi.mock('@/services/electron/devtools', () => ({ electronDevtoolsService: {} }));

describe('background resources', () => {
  const snapshot: ProcessSnapshot = {
    sampledAt: 1,
    totalMemoryMB: 16384,
    processes: [
      {
        id: '1:a',
        rootId: '1:a',
        pid: 1,
        ppid: 0,
        name: 'shell',
        topicId: 'one',
        memoryMB: 100,
        cpuPercent: null,
      },
      {
        id: '2:a',
        rootId: '1:a',
        pid: 2,
        ppid: 1,
        name: 'node',
        topicId: 'one',
        memoryMB: 2500,
        cpuPercent: 50,
      },
      { id: '3:a', rootId: '3:a', pid: 3, ppid: 0, name: 'shared', memoryMB: 40, cpuPercent: 1 },
    ],
  };
  it('counts descendants once and leaves shared services outside topic totals', () => {
    const activities = groupActivities(snapshot);
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({
      topicId: 'one',
      memoryMB: 2600,
      cpuPercent: 50,
      severity: 'warning',
    });
    expect(activities[1].topicId).toBeUndefined();
  });
  it('deduplicates sustained warnings, escalates immediately and rearms after recovery', () => {
    const alerts = new ResourceAlerts();
    const activities = groupActivities(snapshot);
    expect(alerts.update(activities)).toEqual([]);
    expect(alerts.update(activities)).toEqual([]);
    expect(alerts.update(activities)).toHaveLength(1);
    expect(alerts.update(activities)).toEqual([]);
    activities[0].severity = 'critical';
    expect(alerts.update(activities)).toHaveLength(1);
    expect(alerts.update(activities)).toEqual([]);
    activities[0].severity = 'normal';
    for (let i = 0; i < 3; i++) alerts.update(activities);
    activities[0].severity = 'critical';
    expect(alerts.update(activities)).toHaveLength(1);
  });
  it('orders processes depth-first under their parent and survives pid cycles', () => {
    const row = (pid: number, ppid: number) =>
      ({ id: `${pid}`, pid, ppid, name: `p${pid}` }) as ProcessRow;
    const tree = processTree([row(3, 2), row(1, 0), row(4, 1), row(2, 1), row(8, 9), row(9, 8)]);
    expect(tree.map(({ depth, row }) => `${row.pid}:${depth}`)).toEqual([
      '1:0',
      '4:1',
      '2:1',
      '3:2',
      '8:0',
      '9:1',
    ]);
  });
  it('switches to gigabytes at 1024 MB', () => {
    expect(formatMemory(1023.4)).toBe('1023 MB');
    expect(formatMemory(1536)).toBe('1.5 GB');
  });
});
