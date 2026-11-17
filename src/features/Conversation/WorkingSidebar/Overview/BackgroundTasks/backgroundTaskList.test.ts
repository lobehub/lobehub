import type { HeteroBackgroundTask } from '@lobechat/heterogeneous-agents';
import { describe, expect, it } from 'vitest';

import {
  collectBackgroundTasks,
  findLiveOperation,
  FINISHED_TASKS_PREVIEW,
  groupBackgroundTasks,
  locateToolCall,
  outputDirectoryOf,
  resolveStopRoute,
} from './backgroundTaskList';

const task = (overrides: Partial<HeteroBackgroundTask> = {}): HeteroBackgroundTask => ({
  description: 'ping',
  operationId: 'op-live',
  startedAt: 100,
  status: 'running',
  taskId: 't-1',
  toolName: 'Bash',
  ...overrides,
});

const toolMessage = (id: string, backgroundTask?: unknown) => ({
  id,
  pluginState: backgroundTask ? { backgroundTask } : undefined,
  role: 'tool',
  tool_call_id: `call-${id}`,
});

const isLive = (operationId: string | undefined) => operationId === 'op-live';

describe('collectBackgroundTasks', () => {
  it('lists tool messages that carry a task, newest first', () => {
    const items = collectBackgroundTasks(
      [
        toolMessage('a', task({ startedAt: 100, taskId: 'a' })),
        { id: 'assistant', role: 'assistant' },
        toolMessage('plain'),
        toolMessage('b', task({ endedAt: 500, status: 'completed', taskId: 'b' })),
        toolMessage('c', task({ startedAt: 300, taskId: 'c' })),
      ],
      isLive,
    );

    expect(items.map((item) => item.task.taskId)).toEqual(['b', 'c', 'a']);
    expect(items[0]).toMatchObject({ messageId: 'b', toolCallId: 'call-b' });
  });

  it('shows a running task whose run is gone as interrupted', () => {
    const [item] = collectBackgroundTasks(
      [toolMessage('a', task({ operationId: 'op-dead' }))],
      isLive,
    );
    expect(item.status).toBe('interrupted');
    expect(item.task.status).toBe('running');
  });

  it('keeps a finished task as reported, live run or not', () => {
    const [item] = collectBackgroundTasks(
      [toolMessage('a', task({ operationId: 'op-dead', status: 'stopped' }))],
      isLive,
    );
    expect(item.status).toBe('stopped');
  });

  it('skips malformed snapshots', () => {
    expect(
      collectBackgroundTasks(
        [
          toolMessage('a', { status: 'running' }),
          toolMessage('b', task({ status: 'weird' as any })),
        ],
        isLive,
      ),
    ).toEqual([]);
  });
});

describe('groupBackgroundTasks', () => {
  const items = collectBackgroundTasks(
    [
      toolMessage('run', task({ taskId: 'run' })),
      ...Array.from({ length: FINISHED_TASKS_PREVIEW + 2 }, (_, i) =>
        toolMessage(`done-${i}`, task({ endedAt: 1000 + i, status: 'completed', taskId: `d${i}` })),
      ),
    ],
    isLive,
  );

  it('shows every running task and the most recent finished ones', () => {
    const groups = groupBackgroundTasks(items, false);
    expect(groups.running.map((item) => item.task.taskId)).toEqual(['run']);
    expect(groups.finished).toHaveLength(FINISHED_TASKS_PREVIEW);
    expect(groups.finished[0].task.taskId).toBe(`d${FINISHED_TASKS_PREVIEW + 1}`);
    expect(groups.hiddenCount).toBe(2);
  });

  it('shows all finished tasks on request', () => {
    const groups = groupBackgroundTasks(items, true);
    expect(groups.finished).toHaveLength(FINISHED_TASKS_PREVIEW + 2);
    expect(groups.hiddenCount).toBe(0);
  });
});

describe('resolveStopRoute', () => {
  const operations = [
    { id: 'local-op', metadata: {}, status: 'running' },
    { id: 'gw-local', metadata: { serverOperationId: 'server-op' }, status: 'running' },
    { id: 'done-op', metadata: { serverOperationId: 'old-server-op' }, status: 'completed' },
  ];

  it('stops through this window when it hosts the session', () => {
    expect(resolveStopRoute(operations, 'local-op', true)).toBe('local');
  });

  it('stops through the server for a server-hosted run', () => {
    expect(resolveStopRoute(operations, 'server-op', false)).toBe('server');
  });

  it('offers nothing for a local CLI spawn or a finished run', () => {
    expect(resolveStopRoute(operations, 'local-op', false)).toBeUndefined();
    expect(resolveStopRoute(operations, 'old-server-op', false)).toBeUndefined();
    expect(resolveStopRoute(operations, undefined, false)).toBeUndefined();
  });

  it('finds a live run by local or server id', () => {
    expect(findLiveOperation(operations, 'server-op')?.id).toBe('gw-local');
    expect(findLiveOperation(operations, 'done-op')).toBeUndefined();
  });
});

describe('outputDirectoryOf', () => {
  it('returns the parent directory', () => {
    expect(outputDirectoryOf('/tmp/claude/tasks/b1.output')).toBe('/tmp/claude/tasks');
    expect(outputDirectoryOf('C:\\tmp\\b1.output')).toBe('C:\\tmp');
  });
});

describe('locateToolCall', () => {
  it('finds the assistant group that renders the tool call', () => {
    const messages = [
      { id: 'user-1' },
      { children: [{ id: 'block-1', tools: [{ id: 'call-other' }] }], id: 'group-1' },
      {
        children: [{ id: 'block-2' }, { id: 'block-3', tools: [{ id: 'call-bash' }] }],
        id: 'group-2',
      },
    ];
    expect(locateToolCall(messages, 'call-bash')).toEqual({ elementId: 'group-2', index: 2 });
  });

  it('finds a plain assistant message carrying the tool', () => {
    expect(locateToolCall([{ id: 'a', tools: [{ id: 'call-bash' }] }], 'call-bash')).toEqual({
      elementId: 'a',
      index: 0,
    });
  });

  it('returns nothing for a call not displayed', () => {
    expect(locateToolCall([{ id: 'a' }], 'call-bash')).toBeUndefined();
  });
});
