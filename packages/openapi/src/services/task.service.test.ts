// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TaskRestService } from './task.service';

const {
  createTaskMock,
  deleteTaskMock,
  findWithHandoffMock,
  hasAnyPermissionMock,
  notifyAssignedMock,
  resolveMock,
  resolveTaskPatchInvariantsMock,
  runTaskMock,
  updateTaskMock,
} = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  deleteTaskMock: vi.fn(),
  findWithHandoffMock: vi.fn(),
  hasAnyPermissionMock: vi.fn(),
  notifyAssignedMock: vi.fn(),
  resolveMock: vi.fn(),
  resolveTaskPatchInvariantsMock: vi.fn(),
  runTaskMock: vi.fn(),
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
vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: class {
    findWithHandoff = findWithHandoffMock;
  },
}));
// The run itself (archived-task refusal, rollback on a failed start) is covered
// by the runner's own tests; here we only pin that the REST run reaches it.
vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: class {
    runTask = runTaskMock;
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
// The ping itself is the tRPC boundary's shared helper; here we only pin that
// the REST create/patch actually reaches it.
vi.mock('@/server/services/task/assignmentNotification', () => ({
  notifyAssignedBestEffort: notifyAssignedMock,
}));

const CALLER = 'me';
const WORKSPACE = 'ws-1';

describe('TaskRestService delete scope', () => {
  const service = (workspaceId?: string) =>
    new TaskRestService({} as LobeChatDatabase, CALLER, workspaceId);

  beforeEach(() => {
    vi.clearAllMocks();
    hasAnyPermissionMock.mockResolvedValue(false);
    resolveMock.mockResolvedValue({ createdByUserId: 'other-member', id: 'task-1' });
  });

  it('deletes a visible task created by another workspace member', async () => {
    deleteTaskMock.mockResolvedValue({ id: 'task-1' });

    await expect(service(WORKSPACE).deleteTask('task-1')).resolves.toEqual({ id: 'task-1' });
    expect(deleteTaskMock).toHaveBeenCalledWith('task-1');
  });

  it('reports a task the caller cannot see as not found', async () => {
    resolveMock.mockResolvedValue(null);

    await expect(service(WORKSPACE).deleteTask('task-1')).rejects.toThrow(/Task not found/);
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

/**
 * Assigning through REST must reach the assignee's inbox the way assigning
 * in-app does: the tRPC boundaries ping via `notifyAssignedBestEffort`, so the
 * REST create and the REST patch have to as well, and the patch has to stay
 * silent unless the assignee actually changed.
 */
describe('TaskRestService assignment notification', () => {
  const service = () => new TaskRestService({} as LobeChatDatabase, CALLER, WORKSPACE);

  beforeEach(() => {
    vi.clearAllMocks();
    hasAnyPermissionMock.mockResolvedValue(false);
  });

  it('notifies the member a create assigned the task to', async () => {
    const created = {
      assigneeUserId: 'other-member',
      id: 'task-1',
      identifier: 'TASK-1',
      name: 'ship it',
    };
    createTaskMock.mockResolvedValue(created);

    await expect(
      service().createTask({ assigneeUserId: 'other-member', instruction: 'ship it' }),
    ).resolves.toEqual(created);

    expect(notifyAssignedMock).toHaveBeenCalledWith(
      { userId: CALLER, workspaceId: WORKSPACE },
      created,
    );
  });

  it('notifies when a patch actually changes the assignee', async () => {
    resolveTaskPatchInvariantsMock.mockResolvedValue({
      data: { assigneeUserId: 'other-member' },
      resolved: { assigneeUserId: null, id: 'task-1' },
    });
    const updated = {
      assigneeUserId: 'other-member',
      id: 'task-1',
      identifier: 'TASK-1',
      name: 'ship it',
    };
    updateTaskMock.mockResolvedValue(updated);

    await expect(
      service().updateTask('task-1', { assigneeUserId: 'other-member' }),
    ).resolves.toEqual(updated);

    expect(notifyAssignedMock).toHaveBeenCalledWith(
      { userId: CALLER, workspaceId: WORKSPACE },
      updated,
    );
  });

  it('stays silent when the patch leaves the assignee untouched', async () => {
    resolveTaskPatchInvariantsMock.mockResolvedValue({
      data: { name: 'renamed' },
      resolved: { assigneeUserId: 'other-member', id: 'task-1' },
    });
    updateTaskMock.mockResolvedValue({
      assigneeUserId: 'other-member',
      id: 'task-1',
      identifier: 'TASK-1',
      name: 'renamed',
    });

    await service().updateTask('task-1', { name: 'renamed' });

    expect(notifyAssignedMock).not.toHaveBeenCalled();
  });
});

describe('TaskRestService runs', () => {
  const service = () => new TaskRestService({} as LobeChatDatabase, CALLER, WORKSPACE);

  beforeEach(() => {
    vi.clearAllMocks();
    hasAnyPermissionMock.mockResolvedValue(false);
    resolveMock.mockResolvedValue({ createdByUserId: CALLER, id: 'task-1' });
  });

  it('starts a run on the resolved task with the extra prompt', async () => {
    runTaskMock.mockResolvedValue({ taskId: 'task-1', topicId: 'tpc-1' });

    await expect(service().runTask('TASK-1', { prompt: 'focus on Osaka' })).resolves.toEqual({
      taskId: 'task-1',
      topicId: 'tpc-1',
    });
    expect(runTaskMock).toHaveBeenCalledWith({ extraPrompt: 'focus on Osaka', taskId: 'task-1' });
  });

  it('reports a task the caller cannot see as not found instead of running it', async () => {
    resolveMock.mockResolvedValue(null);

    await expect(service().runTask('task-1', {})).rejects.toThrow(/Task not found/);
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it('lists runs newest first with the handoff result and without the brief audit', async () => {
    findWithHandoffMock.mockResolvedValue([
      {
        agentId: 'agt-1',
        completedAt: new Date('2026-10-23T08:05:00Z'),
        createdAt: new Date('2026-10-23T08:00:00Z'),
        handoff: {
          briefDecision: { emit: true, reason: 'changed', source: 'rule' },
          content: 'Round trip to Osaka is ¥1,880 on ANA.',
          summary: 'Found a fare under budget',
        },
        metadata: { internal: true },
        operationId: 'op-1',
        seq: 3,
        status: 'completed',
        title: 'Osaka fares',
        topicId: 'tpc-3',
        trigger: 'schedule',
      },
    ]);

    const runs = (await service().listRuns('task-1', {})) as Record<string, unknown>[];

    expect(findWithHandoffMock).toHaveBeenCalledWith('task-1', 20);
    expect(runs).toEqual([
      expect.objectContaining({
        content: 'Round trip to Osaka is ¥1,880 on ANA.',
        notable: true,
        seq: 3,
        status: 'completed',
        summary: 'Found a fare under budget',
        title: 'Osaka fares',
        topicId: 'tpc-3',
        trigger: 'schedule',
      }),
    ]);
    expect(runs[0]).not.toHaveProperty('briefDecision');
    expect(runs[0]).not.toHaveProperty('metadata');
    expect(runs[0]).not.toHaveProperty('operationId');
  });

  it('reports a run the lifecycle never judged as notable: null', async () => {
    findWithHandoffMock.mockResolvedValue([
      { createdAt: new Date(), handoff: null, seq: 1, status: 'running', topicId: 'tpc-1' },
    ]);

    const [run] = (await service().listRuns('task-1', {})) as Record<string, unknown>[];

    expect(run).toMatchObject({ notable: null, summary: null, topicId: 'tpc-1' });
  });

  it('passes the requested page size through', async () => {
    findWithHandoffMock.mockResolvedValue([]);

    await service().listRuns('task-1', { limit: 5 });

    expect(findWithHandoffMock).toHaveBeenCalledWith('task-1', 5);
  });
});
