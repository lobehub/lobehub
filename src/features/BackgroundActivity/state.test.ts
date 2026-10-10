import { describe, expect, it, vi } from 'vitest';

import {
  activityLocation,
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
        agentId: 'agt_1',
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
        agentId: 'agt_1',
        messageId: 'msg/tool 1',
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
  it('links an owned activity back to the message that started it', () => {
    const [owned, shared] = groupActivities(snapshot);
    const noWorkspaces = () => undefined;
    expect(owned.messageId).toBe('msg/tool 1');
    expect(activityLocation(owned, noWorkspaces)).toEqual({
      hash: 'msg%2Ftool%201',
      href: '/agent/agt_1/one#msg%2Ftool%201',
      path: '/agent/agt_1/one',
    });
    expect(activityLocation({ ...owned, messageId: undefined }, noWorkspaces)?.href).toBe(
      '/agent/agt_1/one',
    );
    expect(activityLocation(shared, noWorkspaces)).toBeUndefined();
  });
  it('opens a group-owned activity in the group conversation', () => {
    const [owned] = groupActivities(snapshot);
    expect(activityLocation({ ...owned, groupId: 'grp_1' }, () => undefined)?.href).toBe(
      '/group/grp_1/one#msg%2Ftool%201',
    );
  });
  it('scopes the link to the workspace that launched the process, not the active one', () => {
    const [owned] = groupActivities({
      ...snapshot,
      processes: snapshot.processes.map((row) => ({ ...row, workspaceId: 'ws_1' })),
    });
    const slugOf = (id: string) => (id === 'ws_1' ? 'acme' : undefined);
    expect(owned.workspaceId).toBe('ws_1');
    expect(activityLocation(owned, slugOf)?.href).toBe('/acme/agent/agt_1/one#msg%2Ftool%201');
    // A workspace the user can no longer reach gets no link rather than a wrong one.
    expect(activityLocation({ ...owned, workspaceId: 'ws_gone' }, slugOf)).toBeUndefined();
  });
});
