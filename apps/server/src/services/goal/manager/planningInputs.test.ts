// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VERIFIED_TASK_LIMIT, verifiedTasks } from './planningInputs';

const { findRuns, findVerdicts } = vi.hoisted(() => ({
  findRuns: vi.fn(),
  findVerdicts: vi.fn(),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(function () {
    return { findWithHandoffByTaskIds: findRuns };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperations: findVerdicts };
  }),
}));

const ctx = { db: {}, userId: 'user-1' } as any;
const graphOf = (...nodes: { id: string; status: string; taskId?: string; title?: string }[]) =>
  ({ nodes }) as any;
const verdict = (status: string, passed = 4, total = 4) => ({ passed, status, total });

describe('verifiedTasks', () => {
  beforeEach(() => {
    findRuns.mockReset().mockResolvedValue([]);
    findVerdicts.mockReset().mockResolvedValue(new Map());
  });

  it('lists a resolved Task whose latest run passed', async () => {
    findRuns.mockResolvedValue([
      { operationId: 'op-1', seq: 1, sourceTaskId: 'task-1' },
      { operationId: 'op-2', seq: 2, sourceTaskId: 'task-1' },
    ]);
    findVerdicts.mockResolvedValue(
      new Map([
        ['op-1', verdict('failed', 1)],
        ['op-2', verdict('passed')],
      ]),
    );

    await expect(
      verifiedTasks(ctx, graphOf({ id: 'n', status: 'resolved', taskId: 'task-1', title: 'T' })),
    ).resolves.toEqual([{ checks: '4/4', taskId: 'task-1', taskTitle: 'T' }]);
  });

  it('reads the latest run, so an earlier pass does not outlive a later failure', async () => {
    findRuns.mockResolvedValue([
      { operationId: 'op-1', seq: 1, sourceTaskId: 'task-1' },
      { operationId: 'op-2', seq: 2, sourceTaskId: 'task-1' },
    ]);
    findVerdicts.mockResolvedValue(
      new Map([
        ['op-1', verdict('passed')],
        ['op-2', verdict('failed', 1)],
      ]),
    );

    await expect(
      verifiedTasks(ctx, graphOf({ id: 'n', status: 'resolved', taskId: 'task-1' })),
    ).resolves.toEqual([]);
  });

  it('skips a verdict with no checks and a Task that is still open', async () => {
    findRuns.mockResolvedValue([{ operationId: 'op-1', seq: 1, sourceTaskId: 'task-1' }]);
    findVerdicts.mockResolvedValue(new Map([['op-1', verdict('passed', 0, 0)]]));

    await expect(
      verifiedTasks(
        ctx,
        graphOf(
          { id: 'n', status: 'resolved', taskId: 'task-1' },
          { id: 'm', status: 'active', taskId: 'task-2' },
        ),
      ),
    ).resolves.toEqual([]);
    expect(findRuns.mock.calls[0][0]).toEqual(['task-1']);
  });

  it('reads only the newest nodes up to the limit', async () => {
    const nodes = Array.from({ length: VERIFIED_TASK_LIMIT + 5 }, (_, i) => ({
      id: `n${i}`,
      status: 'resolved',
      taskId: `task-${i}`,
    }));

    await verifiedTasks(ctx, graphOf(...nodes));

    expect(findRuns.mock.calls[0][0]).toHaveLength(VERIFIED_TASK_LIMIT);
    expect(findRuns.mock.calls[0][0][0]).toBe('task-5');
  });
});
