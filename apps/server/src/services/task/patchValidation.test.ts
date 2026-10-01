// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTaskPatchInvariants } from './patchValidation';

const { assertAgentUsableByMock } = vi.hoisted(() => ({ assertAgentUsableByMock: vi.fn() }));

vi.mock('@/database/utils/agent-access', () => ({
  assertAgentUsableBy: assertAgentUsableByMock,
}));

const CALLER = 'me';
const WORKSPACE = 'ws-1';

/** The row `TaskModel.resolve` hands back for `id`. */
const storedTask = (id: string, overrides: Record<string, unknown> = {}) => ({
  createdByUserId: CALLER,
  id,
  projectId: 'project-1',
  schedulePattern: null,
  scheduleTimezone: null,
  visibility: 'public' as const,
  ...overrides,
});

/**
 * The fake task model resolves by id, like the real one — a fixture that
 * returned the same row for every id would make the self-parent guard fire in
 * every hierarchy case and hide the check under test.
 */
const buildContext = (rows: Record<string, Record<string, unknown>> = {}) => {
  const taskModel = {
    findAllDescendants: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue({ id: 'parent-1', projectId: 'project-1' }),
    resolve: vi.fn(async (id: string) => storedTask(id, rows[id])),
  };
  const taskService = {
    assertAgentVisibilityCompat: vi.fn(),
    assertAssigneeUserVisibilityCompat: vi.fn(),
    assertParentVisibilityCompat: vi.fn(),
  };
  const agentModel = { getAgentVisibility: vi.fn().mockResolvedValue('public') };
  const editLockService = { getBlockingHolder: vi.fn().mockResolvedValue(null) };

  return {
    agentModel,
    context: {
      agentModel,
      editLockService,
      serverDB: {} as never,
      taskModel: taskModel as never,
      taskService: taskService as never,
      userId: CALLER,
      workspaceId: WORKSPACE,
    },
    editLockService,
    taskModel,
    taskService,
  };
};

describe('resolveTaskPatchInvariants hierarchy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('refuses parenting a task to itself', async () => {
    const { context } = buildContext();
    const patch = { parentTaskId: 'task-1' };

    await expect(
      resolveTaskPatchInvariants(context, { data: patch, id: 'task-1', parentTaskId: 'task-1' }),
    ).rejects.toThrow('Task cannot be parented to itself');
  });

  it('refuses parenting a task to one of its own descendants', async () => {
    const { context, taskModel } = buildContext();
    const patch = { parentTaskId: 'child-1' };
    taskModel.findAllDescendants.mockResolvedValue([{ id: 'child-1' }]);

    await expect(
      resolveTaskPatchInvariants(context, { data: patch, id: 'task-1', parentTaskId: 'child-1' }),
    ).rejects.toThrow('Task cannot be parented to its own descendant');
  });

  it('refuses a parent from another project', async () => {
    const { context } = buildContext({ 'parent-1': { projectId: 'project-2' } });
    const patch = { parentTaskId: 'parent-1' };

    await expect(
      resolveTaskPatchInvariants(context, { data: patch, id: 'task-1', parentTaskId: 'parent-1' }),
    ).rejects.toThrow('Parent task must belong to the same project');
  });

  it('refuses a public child under a private parent', async () => {
    const { context, taskService } = buildContext({ 'task-1': { visibility: 'public' } });
    const patch = { parentTaskId: 'parent-1' };
    taskService.assertParentVisibilityCompat.mockImplementation(() => {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subtask cannot be more public than' });
    });

    await expect(
      resolveTaskPatchInvariants(context, { data: patch, id: 'task-1', parentTaskId: 'parent-1' }),
    ).rejects.toThrow('Subtask cannot be more public than');
    expect(taskService.assertParentVisibilityCompat).toHaveBeenCalledWith('public', undefined);
  });

  it('accepts clearing the parent', async () => {
    const { context, taskModel } = buildContext();
    const patch = { parentTaskId: null };

    const result = await resolveTaskPatchInvariants(context, {
      data: patch,
      id: 'task-1',
      parentTaskId: null,
    });

    expect(result.data.parentTaskId).toBeNull();
    expect(taskModel.findAllDescendants).not.toHaveBeenCalled();
  });
});

describe('resolveTaskPatchInvariants assignment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('refuses an assignee agent the caller cannot use', async () => {
    const { context } = buildContext();
    const patch = { assigneeAgentId: 'agent-1' };
    assertAgentUsableByMock.mockRejectedValue(
      new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' }),
    );

    await expect(
      resolveTaskPatchInvariants(context, { data: patch, id: 'task-1' }),
    ).rejects.toThrow('Assignee agent not found');
  });

  it('refuses a private assignee agent on a public task', async () => {
    const { context, taskService } = buildContext({ 'task-1': { visibility: 'public' } });
    const patch = { assigneeAgentId: 'agent-1' };
    taskService.assertAgentVisibilityCompat.mockImplementation(() => {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Public task needs a public agent' });
    });

    await expect(
      resolveTaskPatchInvariants(context, { data: patch, id: 'task-1' }),
    ).rejects.toThrow('Public task needs a public agent');
  });

  it('checks the assignee before resolving the task', async () => {
    const { context, taskModel } = buildContext();
    const patch = { assigneeAgentId: 'agent-1' };
    assertAgentUsableByMock.mockRejectedValue(
      new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' }),
    );

    await expect(
      resolveTaskPatchInvariants(context, { data: patch, id: 'missing-task' }),
    ).rejects.toThrow('Assignee agent not found');
    expect(taskModel.resolve).not.toHaveBeenCalled();
  });

  it('refuses a patch that would leave an unusable stored schedule', async () => {
    const { context } = buildContext({ 'task-1': { scheduleTimezone: 'Legacy/Zone' } });
    const patch = { automationMode: 'schedule' };

    await expect(
      resolveTaskPatchInvariants(context, { data: patch, id: 'task-1' }),
    ).rejects.toThrow('Invalid schedule');
  });
});

describe('resolveTaskPatchInvariants edit lock', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('refuses a write while another member holds the edit lock', async () => {
    const { context, editLockService } = buildContext();
    const patch = { name: 'renamed' };
    editLockService.getBlockingHolder.mockResolvedValue('other-member');

    await expect(
      resolveTaskPatchInvariants(context, { data: patch, id: 'task-1' }),
    ).rejects.toThrow('Task is being edited by another user');
  });

  it('does not consult the edit lock outside a workspace', async () => {
    const { context, editLockService } = buildContext();
    const patch = { name: 'renamed' };
    const personal = { ...context, workspaceId: undefined };

    await resolveTaskPatchInvariants(personal, { data: patch, id: 'task-1' });

    expect(editLockService.getBlockingHolder).not.toHaveBeenCalled();
  });
});

describe('resolveTaskPatchInvariants normalization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('drops the stale rich-text mirror when only markdown is sent', async () => {
    const { context } = buildContext();
    const markdownOnly: { editorData?: unknown; instruction: string } = { instruction: '# done' };

    const onlyMarkdown = await resolveTaskPatchInvariants(context, {
      data: markdownOnly,
      id: 'task-1',
    });
    expect(onlyMarkdown.data.editorData).toBeNull();
  });

  it('keeps an explicit editor state when both fields are sent', async () => {
    const { context } = buildContext();
    const both = { editorData: { root: {} }, instruction: '# done' };

    const result = await resolveTaskPatchInvariants(context, { data: both, id: 'task-1' });

    expect(result.data.editorData).toEqual({ root: {} });
  });
});
