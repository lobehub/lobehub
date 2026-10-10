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
  agentId?: string,
): Activity => ({
  agentId,
  messageId: agentId ? `msg-${rootId}` : undefined,
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
    agentId,
    topicId,
  })),
  rootId,
  severity: 'normal',
  topicId,
});

const AGENTS: Record<string, string> = { a1: 'Coder', a2: 'Reviewer' };

const build = (
  query = '',
  activities = [
    activity('unowned', undefined, 90, ['tail']),
    activity('slow', 't1', 1, ['sh', 'node'], 'a1'),
    activity('busy', 't1', 50, ['vite'], 'a1'),
  ],
) =>
  buildProcessTree({
    activities,
    agentTitle: (id) => AGENTS[id],
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
    workspaceSlug: () => undefined,
  });

describe('buildProcessTree', () => {
  it('keeps unassigned processes last and orders the rest by the sort column', () => {
    const [background] = build().treeData;
    expect(background.children!.map((node) => node.key)).toEqual([
      'conversation:t1:a1',
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
    expect(background.children!.map((node) => node.key)).toEqual(['conversation:t1:a1']);
    expect(background.children![0].children!.map((node) => node.key)).toEqual(['activity:slow']);
    expect(app.children).toBeUndefined();
  });

  it('names each conversation by its owning agent and topic, and filters by agent name', () => {
    const { rows } = build();
    expect(rows.get('conversation:t1:a1')).toMatchObject({
      agentId: 'a1',
      label: 'Coder / Auth topic',
      topicId: 't1',
    });
    expect(rows.get('conversation:shared')).toMatchObject({ agentId: undefined, label: 'Shared' });
    expect(rows.get('activity:busy')?.href).toBe('/agent/a1/t1#msg-busy');
    expect(rows.get('activity:unowned')?.href).toBeUndefined();

    const [background] = build('coder').treeData;
    expect(background.children!.map((node) => node.key)).toEqual(['conversation:t1:a1']);
  });

  it('keeps each group member as the owner of its own commands in a shared topic', () => {
    const members = [
      activity('coder-run', 't1', 5, ['vite'], 'a1'),
      activity('reviewer-run', 't1', 9, ['jest'], 'a2'),
    ];
    const { rows, treeData } = build('', members);
    expect(rows.get('conversation:t1:a1')).toMatchObject({ label: 'Coder / Auth topic' });
    expect(rows.get('conversation:t1:a2')).toMatchObject({ label: 'Reviewer / Auth topic' });
    expect(
      treeData[0].children!.find((node) => node.key === 'conversation:t1:a2')!.children,
    ).toEqual([expect.objectContaining({ key: 'activity:reviewer-run' })]);

    // Searching the second member finds that member's commands, not none.
    const [background] = build('reviewer', members).treeData;
    expect(background.children!.map((node) => node.key)).toEqual(['conversation:t1:a2']);
  });
});
