// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TaskRestService } from './task.service';

const { createTaskMock, deleteTaskMock, hasAnyPermissionMock, resolveMock, updateTaskMock } =
  vi.hoisted(() => ({
    createTaskMock: vi.fn(),
    deleteTaskMock: vi.fn(),
    hasAnyPermissionMock: vi.fn(),
    resolveMock: vi.fn(),
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
vi.mock('@/database/models/task', () => ({
  TaskModel: class {
    resolve = resolveMock;
  },
}));
vi.mock('@/server/services/task', () => ({
  TaskService: class {
    createTask = createTaskMock;
    deleteTask = deleteTaskMock;
    updateTaskWithAssigneeLock = updateTaskMock;
  },
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

/**
 * The REST schemas check `schedulePattern` and `scheduleTimezone` one field at a
 * time; these cases pin the resulting-pair check, which is what stops a patch
 * from keeping a legacy timezone the dispatcher cannot evaluate.
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

  it('refuses a patch that would leave an unusable stored timezone in place', async () => {
    resolveMock.mockResolvedValue({
      createdByUserId: CALLER,
      id: 'task-1',
      schedulePattern: null,
      scheduleTimezone: 'Legacy/Zone',
    });

    await expect(service().updateTask('task-1', { automationMode: 'schedule' })).rejects.toThrow(
      /Invalid schedule/,
    );
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it('patches a pattern against the stored timezone', async () => {
    resolveMock.mockResolvedValue({
      createdByUserId: CALLER,
      id: 'task-1',
      schedulePattern: null,
      scheduleTimezone: 'Asia/Shanghai',
    });
    updateTaskMock.mockResolvedValue({ id: 'task-1' });

    await expect(
      service().updateTask('task-1', { schedulePattern: '0 9 * * 1-5' }),
    ).resolves.toEqual({ id: 'task-1' });
    expect(updateTaskMock).toHaveBeenCalledTimes(1);
  });
});
