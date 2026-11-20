import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskRuntime } from '../task';

vi.mock('@/business/server/task/notifyTaskAssigned', () => ({ notifyTaskAssigned: vi.fn() }));

// Server-only env, read for absolute task links.
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));

// The real router imports the runtime registry back; the runtime only needs a caller.
vi.mock('@/server/routers/lambda/task', () => ({ taskRouter: { createCaller: vi.fn() } }));

// TaskService pulls ModelRuntime at module load; each test passes its own stub.
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

const createdTask = {
  assigneeUserId: null,
  id: 'task-1',
  identifier: 'T-1',
  name: 'Run',
  priority: 0,
  status: 'backlog',
};

const setup = () => {
  const taskService = { createTask: vi.fn().mockResolvedValue(createdTask) };
  const taskCaller = { update: vi.fn().mockResolvedValue({ data: { id: 'task-1' } }) };
  const taskModel = { resolve: vi.fn().mockResolvedValue(createdTask) };
  const runtime = createTaskRuntime({
    agentId: 'agt-1',
    agentModel: { existsById: vi.fn().mockResolvedValue(true) } as any,
    db: {} as any,
    taskCaller: taskCaller as any,
    taskModel: taskModel as any,
    taskService: taskService as any,
    topicId: 'tpc-1',
    userId: 'user-1',
  });
  return { runtime, taskCaller, taskService };
};

describe('task runtime — task model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a task with the requested model in config', async () => {
    const { runtime, taskService } = setup();

    await runtime.createTask({
      instruction: 'Run',
      model: 'deepseek-chat',
      name: 'Run',
      provider: 'lobehub',
    });

    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ config: { model: 'deepseek-chat', provider: 'lobehub' } }),
    );
  });

  it('leaves config to the assignee snapshot when no model is given', async () => {
    const { runtime, taskService } = setup();

    await runtime.createTask({ instruction: 'Run', name: 'Run' });

    expect(taskService.createTask.mock.calls[0][0].config).toBeUndefined();
  });

  it('carries a per-item model through createTasks', async () => {
    const { runtime, taskService } = setup();

    await runtime.createTasks({
      tasks: [
        { instruction: 'A', model: 'gpt-5', name: 'A' },
        { instruction: 'B', name: 'B' },
      ],
    });

    expect(taskService.createTask.mock.calls[0][0].config).toEqual({ model: 'gpt-5' });
    expect(taskService.createTask.mock.calls[1][0].config).toBeUndefined();
  });

  it('refuses a provider without a model before creating anything', async () => {
    const { runtime, taskService } = setup();

    const result = await runtime.createTask({
      instruction: 'Run',
      name: 'Run',
      provider: 'openai',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('provider needs model');
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('merges a model edit as a config patch', async () => {
    const { runtime, taskCaller } = setup();

    const result = await runtime.editTask({
      identifier: 'T-1',
      model: 'deepseek-chat',
      provider: 'lobehub',
    });

    expect(result.success).toBe(true);
    expect(taskCaller.update).toHaveBeenCalledWith({
      configPatch: { model: 'deepseek-chat', provider: 'lobehub' },
      id: 'task-1',
    });
    expect(result.content).toContain('model → lobehub/deepseek-chat');
  });

  it('clears both keys so the task follows its assignee again', async () => {
    const { runtime, taskCaller } = setup();

    await runtime.editTask({ identifier: 'T-1', model: null });

    expect(taskCaller.update).toHaveBeenCalledWith({
      configPatch: { model: null, provider: null },
      id: 'task-1',
    });
  });

  it('sends no config patch for edits without a model', async () => {
    const { runtime, taskCaller } = setup();

    await runtime.editTask({ identifier: 'T-1', name: 'Renamed' });

    expect(taskCaller.update).toHaveBeenCalledWith({ id: 'task-1', name: 'Renamed' });
  });
});
