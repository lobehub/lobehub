import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskRuntime } from '../task';

vi.mock('@/business/server/task/notifyTaskAssigned', () => ({ notifyTaskAssigned: vi.fn() }));
vi.mock('@/server/routers/lambda/task', () => ({ taskRouter: { createCaller: vi.fn() } }));
vi.mock('@/server/routers/lambda/taskLabel', () => ({
  taskLabelRouter: { createCaller: vi.fn() },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

const registry = [
  { id: 'g', isGroup: true, name: 'Type', parentId: null },
  { id: 'bug', isGroup: false, name: 'Bug', parentId: 'g' },
  { id: 'feat', isGroup: false, name: 'Feature', parentId: 'g' },
  { id: 'fe', isGroup: false, name: 'Frontend', parentId: null },
];

const task = { id: 'task-1', identifier: 'T-1', name: 'Ship', priority: 0, status: 'backlog' };

const setup = () => {
  const taskLabelCaller = {
    addToTask: vi.fn().mockResolvedValue([{ id: 'bug', name: 'Bug' }]),
    list: vi.fn().mockResolvedValue(registry),
    removeFromTask: vi.fn().mockResolvedValue([]),
  };
  const taskCaller = {
    list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    update: vi.fn().mockResolvedValue({ data: task }),
  };
  const taskService = { createTask: vi.fn().mockResolvedValue(task) };
  const runtime = createTaskRuntime({
    agentModel: { existsById: vi.fn().mockResolvedValue(true) } as any,
    taskCaller: taskCaller as any,
    taskLabelCaller: taskLabelCaller as any,
    taskModel: { resolve: vi.fn().mockResolvedValue(task) } as any,
    taskService: taskService as any,
  });
  return { runtime, taskCaller, taskLabelCaller, taskService };
};

describe('task tool labels', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createTask attaches resolved labels and reports them', async () => {
    const { runtime, taskLabelCaller } = setup();

    const result = await runtime.createTask({
      instruction: 'x',
      labels: ['Type/Bug'],
      name: 'Ship',
    });

    expect(result.success).toBe(true);
    expect(taskLabelCaller.addToTask).toHaveBeenCalledWith({ labelIds: ['bug'], taskId: 'task-1' });
    expect(result.content).toContain('Labels: Bug');
  });

  it('createTask with an unknown label creates nothing and suggests names', async () => {
    const { runtime, taskService } = setup();

    const result = await runtime.createTask({
      instruction: 'x',
      labels: ['Frontnd'],
      name: 'Ship',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('did you mean: Frontend');
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('editTask removes before adding labels', async () => {
    const { runtime, taskLabelCaller } = setup();

    const result = await runtime.editTask({
      addLabels: ['Feature'],
      identifier: 'T-1',
      removeLabels: ['Frontend'],
    });

    expect(result.success).toBe(true);
    expect(taskLabelCaller.removeFromTask).toHaveBeenCalledWith({
      labelIds: ['fe'],
      taskId: 'task-1',
    });
    expect(taskLabelCaller.addToTask).toHaveBeenCalledWith({
      labelIds: ['feat'],
      taskId: 'task-1',
    });
    expect(taskLabelCaller.removeFromTask.mock.invocationCallOrder[0]).toBeLessThan(
      taskLabelCaller.addToTask.mock.invocationCallOrder[0],
    );
  });

  it('listTasks filters by label and group names', async () => {
    const { runtime, taskCaller } = setup();

    await runtime.listTasks({ labels: ['Type', 'Frontend'] });

    expect(taskCaller.list).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { label: { operator: 'is', values: ['g', 'fe'] } } }),
    );
  });
});
