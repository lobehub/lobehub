import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskRuntime } from '../task';

const projectMocks = vi.hoisted(() => ({
  findById: vi.fn(),
  listAgents: vi.fn(),
  resolveCoordinatorAgents: vi.fn(),
}));

vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn().mockImplementation(function () {
    return projectMocks;
  }),
}));

vi.mock('@/business/server/task/notifyTaskAssigned', () => ({ notifyTaskAssigned: vi.fn() }));

// Server-only env, read for absolute task links.
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));

// The real router imports the runtime registry back; the runtime only needs a caller.
vi.mock('@/server/routers/lambda/task', () => ({ taskRouter: { createCaller: vi.fn() } }));

// TaskService pulls ModelRuntime at module load; each test passes its own stub.
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

const member = (id: string, title: string, role: string | null, enabled = true) => ({
  agent: { id, title },
  binding: { enabled, role },
});

const createdTask = {
  assigneeUserId: null,
  id: 'task-1',
  identifier: 'APO-1',
  name: 'Draft launch post',
  priority: 0,
  status: 'backlog',
};

const setup = (overrides: { parent?: { id: string; identifier: string; projectId: string } }) => {
  const taskService = {
    createTask: vi.fn().mockResolvedValue(createdTask),
    updateTaskWithAssigneeLock: vi.fn().mockResolvedValue({}),
  };
  const taskModel = {
    resolve: vi.fn(async (identifier: string) =>
      overrides.parent?.identifier === identifier ? overrides.parent : null,
    ),
  };
  const runtime = createTaskRuntime({
    agentId: 'agt-coordinator',
    agentModel: { existsById: vi.fn().mockResolvedValue(true) } as any,
    db: {} as any,
    projectId: 'proj-apollo',
    taskCaller: { update: vi.fn().mockResolvedValue({ data: { id: 'task-1' } }) } as any,
    taskModel: taskModel as any,
    taskService: taskService as any,
    topicId: 'tpc-1',
    userId: 'user-1',
  });
  return { runtime, taskModel, taskService };
};

describe('task runtime inside a project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectMocks.findById.mockImplementation(async (id: string) => ({
      coordinatorAgentId: null,
      id,
    }));
    // A cleared main agent reads back as LobeAI.
    projectMocks.resolveCoordinatorAgents.mockImplementation(async (items: any[]) =>
      items.map((item) => ({
        ...item,
        coordinatorAgentId: item.coordinatorAgentId ?? 'agt-lobe-ai',
      })),
    );
    projectMocks.listAgents.mockResolvedValue([
      member('agt-coordinator', 'Apollo Coordinator', 'coordinator'),
      member('agt-writer', 'Writer', 'copywriter'),
      member('agt-retired', 'Retired', 'reviewer', false),
    ]);
  });

  it('files the tasks it creates under the run project', async () => {
    const { runtime, taskService } = setup({});

    const result = await runtime.createTask({
      assigneeAgentId: 'agt-writer',
      instruction: 'Write the launch post',
      name: 'Draft launch post',
    });

    expect(result.success).toBe(true);
    expect(projectMocks.listAgents).toHaveBeenCalledWith('proj-apollo');
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeAgentId: 'agt-writer', projectId: 'proj-apollo' }),
    );
  });

  it('refuses to hand project work to an agent outside the project and lists who can take it', async () => {
    const { runtime, taskService } = setup({});

    const result = await runtime.createTask({
      assigneeAgentId: 'agt-outsider',
      instruction: 'Write the launch post',
      name: 'Draft launch post',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('agt-outsider is not a member of this project');
    expect(result.content).toContain('Writer (agt-writer) — copywriter');
    // A disabled member is not offered either.
    expect(result.content).not.toContain('agt-retired');
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('lets the main agent take project work without a member row', async () => {
    const { runtime, taskService } = setup({});

    const result = await runtime.createTask({
      assigneeAgentId: 'agt-lobe-ai',
      instruction: 'Plan the launch',
      name: 'Launch plan',
    });

    expect(result.success).toBe(true);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeAgentId: 'agt-lobe-ai', projectId: 'proj-apollo' }),
    );
  });

  it("lets a subtask inherit its parent's project instead of the run project", async () => {
    projectMocks.listAgents.mockResolvedValue([member('agt-writer', 'Writer', null)]);
    const { runtime, taskService } = setup({
      parent: { id: 'task-parent', identifier: 'ZEUS-4', projectId: 'proj-zeus' },
    });

    await runtime.createTask({
      assigneeAgentId: 'agt-writer',
      instruction: 'Split out',
      name: 'Sub',
      parentIdentifier: 'ZEUS-4',
    });

    expect(projectMocks.listAgents).toHaveBeenCalledWith('proj-zeus');
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: 'task-parent', projectId: undefined }),
    );
  });

  it("checks a reassignment against the edited task's own project", async () => {
    const { runtime, taskModel } = setup({});
    taskModel.resolve.mockResolvedValue({
      id: 'task-9',
      identifier: 'ZEUS-9',
      projectId: 'proj-zeus',
    });

    const result = await runtime.editTask({
      assigneeAgentId: 'agt-outsider',
      identifier: 'ZEUS-9',
    });

    expect(result.success).toBe(false);
    expect(projectMocks.listAgents).toHaveBeenCalledWith('proj-zeus');
  });
});
