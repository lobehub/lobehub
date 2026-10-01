// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TaskRestService } from './task.service';

const {
  createTaskMock,
  deleteTaskMock,
  hasAnyPermissionMock,
  resolveMock,
  resolveTaskPatchInvariantsMock,
  updateTaskMock,
} = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  deleteTaskMock: vi.fn(),
  hasAnyPermissionMock: vi.fn(),
  resolveMock: vi.fn(),
  resolveTaskPatchInvariantsMock: vi.fn(),
  updateTaskMock: vi.fn(),
}));

vi.mock('@/const/rbac', () => ({ ALL_SCOPE: 'all' }));
vi.mock('@lobechat/database', () => ({
  buildWorkspacePayload: vi.fn(),
  buildWorkspaceWhere: vi.fn(),
}));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = hasAnyPermissionMock;
  },
}));
vi.mock('@/database/schemas', () => ({
  agents: {},
  aiModels: {},
  aiProviders: {},
  files: {},
  knowledgeBases: {},
  messages: {},
  sessions: {},
  topics: {},
}));
vi.mock('@/utils/rbac', () => ({ getScopePermissions: () => [] }));
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentVisibility = vi.fn().mockResolvedValue('public');
  },
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: class {
    resolve = resolveMock;
  },
}));
vi.mock('@/server/services/editLock', () => ({
  EditLockService: class {
    getBlockingHolder = vi.fn().mockResolvedValue(null);
  },
}));
vi.mock('@/server/services/task', () => ({
  TaskService: class {
    createTask = createTaskMock;
    deleteTask = deleteTaskMock;
    updateTaskWithAssigneeLock = updateTaskMock;
  },
}));
// The invariant chain itself is covered by
// `apps/server/src/services/task/patchValidation.test.ts`; here we only pin that
// the REST patch runs through it instead of writing the row directly.
vi.mock('@/server/services/task/patchValidation', () => ({
  resolveTaskPatchInvariants: resolveTaskPatchInvariantsMock,
}));

const CALLER = 'me';
const WORKSPACE = 'ws-1';

describe('TaskRestService creator gate on delete', () => {
  const service = (workspaceId?: string) =>
    new TaskRestService({} as LobeChatDatabase, CALLER, workspaceId);

  beforeEach(() => {
    vi.clearAllMocks();
    hasAnyPermissionMock.mockResolvedValue(false);
    resolveMock.mockResolvedValue({ createdByUserId: 'other-member', id: 'task-1' });
  });

  it('refuses deleting a task created by another workspace member', async () => {
    await expect(service(WORKSPACE).deleteTask('task-1')).rejects.toThrow(
      /Only the creator or a workspace owner/,
    );
    expect(deleteTaskMock).not.toHaveBeenCalled();
  });

  it('deletes a task the caller created', async () => {
    resolveMock.mockResolvedValue({ createdByUserId: CALLER, id: 'task-1' });
    deleteTaskMock.mockResolvedValue({ id: 'task-1' });

    await expect(service(WORKSPACE).deleteTask('task-1')).resolves.toEqual({ id: 'task-1' });
    expect(deleteTaskMock).toHaveBeenCalledWith('task-1');
  });
});

describe('TaskRestService patch runs the shared invariants', () => {
  const service = () => new TaskRestService({} as LobeChatDatabase, CALLER, WORKSPACE);

  beforeEach(() => {
    vi.clearAllMocks();
    hasAnyPermissionMock.mockResolvedValue(false);
    resolveTaskPatchInvariantsMock.mockImplementation(async () => ({
      data: { parentTaskId: 'parent-1' },
      resolved: { createdByUserId: CALLER, id: 'task-1' },
    }));
    updateTaskMock.mockResolvedValue({ id: 'task-1' });
  });

  it('writes the row the invariants resolved, not the raw path id', async () => {
    await expect(service().updateTask('TASK-1', { parentTaskId: 'parent-1' })).resolves.toEqual({
      id: 'task-1',
    });

    expect(resolveTaskPatchInvariantsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: CALLER, workspaceId: WORKSPACE }),
      expect.objectContaining({ id: 'TASK-1', parentTaskId: 'parent-1' }),
    );
    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-1',
      { parentTaskId: 'parent-1' },
      {
        userId: CALLER,
      },
    );
  });

  it('refuses the patch when an invariant rejects it', async () => {
    resolveTaskPatchInvariantsMock.mockRejectedValue(
      new TRPCError({ code: 'BAD_REQUEST', message: 'Task cannot be parented to itself' }),
    );

    await expect(service().updateTask('task-1', { parentTaskId: 'task-1' })).rejects.toThrow(
      'Task cannot be parented to itself',
    );
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it('reports a missing task instead of writing', async () => {
    resolveTaskPatchInvariantsMock.mockRejectedValue(
      new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' }),
    );

    await expect(service().updateTask('missing', { name: 'x' })).rejects.toThrow('Task not found');
    expect(updateTaskMock).not.toHaveBeenCalled();
  });
});

/**
 * The task create boundary still validates its own schedule: `createTask` has no
 * stored row to validate against, so the field schemas plus this pair check are
 * the whole gate.
 */
describe('TaskRestService write-time schedule validation', () => {
  const service = () => new TaskRestService({} as LobeChatDatabase, CALLER, WORKSPACE);

  beforeEach(() => {
    vi.clearAllMocks();
    hasAnyPermissionMock.mockResolvedValue(false);
  });

  it('refuses a create whose cron the dispatcher cannot evaluate', async () => {
    await expect(
      service().createTask({ instruction: 'ship it', schedulePattern: 'every day' }),
    ).rejects.toThrow(/Invalid schedule/);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('refuses a create with an unknown IANA timezone', async () => {
    await expect(
      service().createTask({ instruction: 'ship it', scheduleTimezone: 'Mars/Phobos' }),
    ).rejects.toThrow(/Invalid schedule/);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('creates with a cron pattern and timezone the dispatcher can evaluate', async () => {
    createTaskMock.mockResolvedValue({ id: 'task-1' });

    await expect(
      service().createTask({
        automationMode: 'schedule',
        instruction: 'ship it',
        schedulePattern: '0 9 * * 1-5',
        scheduleTimezone: 'Asia/Shanghai',
      }),
    ).resolves.toEqual({ id: 'task-1' });
    expect(createTaskMock).toHaveBeenCalledTimes(1);
  });
});
