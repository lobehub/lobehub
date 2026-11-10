// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as TaskLabelModule from '@/database/models/taskLabel';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

const mockCreate = vi.fn();
const mockAddTaskLabels = vi.fn();
const mockChangeTaskLabels = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/database/models/taskLabel', async (importOriginal) => {
  const actual = await importOriginal<typeof TaskLabelModule>();
  return {
    ...actual,
    TaskLabelModel: vi.fn(function () {
      return {
        addTaskLabels: mockAddTaskLabels,
        changeTaskLabels: mockChangeTaskLabels,
        create: mockCreate,
        update: mockUpdate,
      };
    }),
  };
});

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/task/utils', () => ({
  resolveTaskOrThrow: vi.fn(async (_model: unknown, id: string) => ({ id: `resolved-${id}` })),
}));

const { TaskLabelError } = await import('@/database/models/taskLabel');
const { taskLabelRouter } = await import('../taskLabel');

const uniqueViolation = (constraint: string) => {
  const error = new Error('duplicate key value violates unique constraint');
  (error as any).cause = { code: '23505', constraint };
  return error;
};

describe('taskLabelRouter', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([['task_labels_user_id_name_unique'], ['task_labels_workspace_id_name_unique']])(
    'maps a %s violation to CONFLICT',
    async (constraint) => {
      mockCreate.mockRejectedValue(uniqueViolation(constraint));
      const caller = taskLabelRouter.createCaller(ctx);

      await expect(caller.create({ name: 'Bug' })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'DUPLICATE_LABEL_NAME',
      });
    },
  );

  it('rejects a non-hex color before it reaches the model', async () => {
    const caller = taskLabelRouter.createCaller(ctx);

    await expect(caller.create({ color: 'url(https://x)', name: 'Bug' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('resolves the task identifier and maps model rule errors', async () => {
    const caller = taskLabelRouter.createCaller(ctx);
    mockAddTaskLabels.mockResolvedValueOnce([{ id: 'l1', name: 'Bug' }]);

    await expect(caller.addToTask({ labelIds: ['l1'], taskId: 'T-1' })).resolves.toEqual([
      { id: 'l1', name: 'Bug' },
    ]);
    expect(mockAddTaskLabels).toHaveBeenCalledWith('resolved-T-1', ['l1']);

    mockAddTaskLabels.mockRejectedValueOnce(new TaskLabelError('GROUP_CONFLICT', 'one per group'));
    await expect(caller.addToTask({ labelIds: ['l1', 'l2'], taskId: 'T-1' })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );

    mockAddTaskLabels.mockRejectedValueOnce(new TaskLabelError('LABEL_NOT_FOUND', 'missing'));
    await expect(caller.addToTask({ labelIds: ['x'], taskId: 'T-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('applies an add + remove delta through one model call', async () => {
    const caller = taskLabelRouter.createCaller(ctx);
    mockChangeTaskLabels.mockResolvedValueOnce([{ id: 'l2', name: 'Backend' }]);

    await expect(
      caller.changeForTask({ add: ['l2'], remove: ['l1'], taskId: 'T-1' }),
    ).resolves.toEqual([{ id: 'l2', name: 'Backend' }]);
    expect(mockChangeTaskLabels).toHaveBeenCalledWith('resolved-T-1', {
      add: ['l2'],
      remove: ['l1'],
    });

    mockChangeTaskLabels.mockRejectedValueOnce(new TaskLabelError('LABEL_NOT_FOUND', 'missing'));
    await expect(caller.changeForTask({ add: ['x'], taskId: 'T-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('passes only the provided fields to update', async () => {
    mockUpdate.mockResolvedValue({ id: 'l1' });
    const caller = taskLabelRouter.createCaller(ctx);

    await caller.update({ id: 'l1', value: { parentId: null } });

    expect(mockUpdate).toHaveBeenCalledWith('l1', { parentId: null });
  });
});
