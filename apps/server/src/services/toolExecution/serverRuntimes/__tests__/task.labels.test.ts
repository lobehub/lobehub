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
    changeForTask: vi.fn().mockResolvedValue([{ id: 'feat', name: 'Feature' }]),
    list: vi.fn().mockResolvedValue(registry),
    removeFromTask: vi.fn().mockResolvedValue([]),
  };
  const taskCaller = {
    detail: vi.fn().mockResolvedValue({ data: { labels: [] } }),
    list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    update: vi.fn().mockResolvedValue({ data: task }),
  };
  const taskService = { createTask: vi.fn().mockResolvedValue(task) };
  const taskModel = {
    delete: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(task),
  };
  const agentModel = { existsById: vi.fn().mockResolvedValue(true) };
  const runtime = createTaskRuntime({
    agentModel: agentModel as any,
    taskCaller: taskCaller as any,
    taskLabelCaller: taskLabelCaller as any,
    taskModel: taskModel as any,
    taskService: taskService as any,
  });
  return { agentModel, runtime, taskCaller, taskLabelCaller, taskModel, taskService };
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

  it('createTask rolls the task back when its labels cannot be attached', async () => {
    const { runtime, taskLabelCaller, taskModel } = setup();
    taskLabelCaller.addToTask.mockRejectedValueOnce(new Error('Labels not found: bug'));

    const result = await runtime.createTask({
      instruction: 'x',
      labels: ['Type/Bug'],
      name: 'Ship',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('Nothing was created');
    expect(taskModel.delete).toHaveBeenCalledWith('task-1');
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

  it('editTask swaps labels in one atomic call', async () => {
    const { runtime, taskLabelCaller } = setup();

    const result = await runtime.editTask({
      addLabels: ['Feature'],
      identifier: 'T-1',
      removeLabels: ['Frontend'],
    });

    expect(result.success).toBe(true);
    expect(taskLabelCaller.changeForTask).toHaveBeenCalledWith({
      add: ['feat'],
      remove: ['fe'],
      taskId: 'task-1',
    });
    expect(taskLabelCaller.addToTask).not.toHaveBeenCalled();
    expect(taskLabelCaller.removeFromTask).not.toHaveBeenCalled();
  });

  it('editTask writes nothing else when the label change fails', async () => {
    const { runtime, taskCaller, taskLabelCaller } = setup();
    taskLabelCaller.changeForTask.mockRejectedValueOnce(new Error('label deleted'));

    await expect(
      runtime.editTask({ addLabels: ['Feature'], identifier: 'T-1', name: 'Renamed' }),
    ).rejects.toThrow('label deleted');
    expect(taskCaller.update).not.toHaveBeenCalled();
  });

  it('editTask undoes only its own label change when a later write fails', async () => {
    const { runtime, taskCaller, taskLabelCaller } = setup();
    // Feature swaps out Bug; `other` was added concurrently by someone else.
    taskCaller.detail
      .mockResolvedValueOnce({
        data: {
          labels: [
            { id: 'bug', parentId: 'g' },
            { id: 'fe', parentId: null },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          labels: [
            { id: 'feat', parentId: 'g' },
            { id: 'fe', parentId: null },
            { id: 'other', parentId: null },
          ],
        },
      });
    taskLabelCaller.changeForTask
      .mockResolvedValueOnce([{ id: 'feat' }, { id: 'fe' }, { id: 'other' }])
      .mockResolvedValueOnce([]);
    taskCaller.update.mockRejectedValueOnce(new Error('update failed'));

    await expect(
      runtime.editTask({ addLabels: ['Feature'], identifier: 'T-1', name: 'Renamed' }),
    ).rejects.toThrow('update failed');
    expect(taskLabelCaller.changeForTask).toHaveBeenLastCalledWith({
      add: ['bug'],
      remove: ['feat'],
      taskId: 'task-1',
    });
  });

  it('editTask undoes its label change when a later input fails validation', async () => {
    const { agentModel, runtime, taskCaller, taskLabelCaller } = setup();
    agentModel.existsById.mockResolvedValue(false);
    taskCaller.detail
      .mockResolvedValueOnce({ data: { labels: [] } })
      .mockResolvedValueOnce({ data: { labels: [{ id: 'feat', parentId: 'g' }] } });
    taskLabelCaller.changeForTask.mockResolvedValueOnce([{ id: 'feat' }]).mockResolvedValueOnce([]);

    const result = await runtime.editTask({
      addLabels: ['Feature'],
      assigneeAgentId: 'agt_missing',
      identifier: 'T-1',
    });

    expect(result.success).toBe(false);
    expect(taskCaller.update).not.toHaveBeenCalled();
    expect(taskLabelCaller.changeForTask).toHaveBeenLastCalledWith({
      add: [],
      remove: ['feat'],
      taskId: 'task-1',
    });
  });

  it('editTask with only labels does not read the task first', async () => {
    const { runtime, taskCaller } = setup();

    const result = await runtime.editTask({ addLabels: ['Feature'], identifier: 'T-1' });

    expect(result.success).toBe(true);
    expect(taskCaller.detail).not.toHaveBeenCalled();
  });

  it('listTasks filters by label and group names', async () => {
    const { runtime, taskCaller } = setup();

    await runtime.listTasks({ labels: ['Type', 'Frontend'] });

    expect(taskCaller.list).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { label: { operator: 'is', values: ['g', 'fe'] } } }),
    );
  });
});
