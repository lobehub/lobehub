import { describe, expect, it, vi } from 'vitest';

import { groupActivities, type ProcessSnapshot, ResourceAlerts } from './state';

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
});
