import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';

import { TaskRunnerService } from './index';

const mocks = vi.hoisted(() => ({
  execAgent: vi.fn(),
  getAgentAgencyConfig: vi.fn(),
  getAgentModelConfig: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn() }));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: vi.fn() }));
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentAgencyConfig: mocks.getAgentAgencyConfig,
      getAgentModelConfig: mocks.getAgentModelConfig,
    };
  }),
}));
vi.mock('@/database/models/brief', () => ({ BriefModel: vi.fn() }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: mocks.execAgent, interruptTask: vi.fn() };
  }),
}));
vi.mock('@/server/services/taskLifecycle', () => ({ TaskLifecycleService: vi.fn() }));
vi.mock('./buildTaskPrompt', () => ({
  buildTaskPrompt: vi.fn().mockResolvedValue({
    acceptanceEnabled: false,
    fileIds: [],
    prompt: 'do it',
  }),
}));

describe('TaskRunnerService.runTask model snapshot backfill', () => {
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as any;
  let taskModel: Record<string, ReturnType<typeof vi.fn>>;

  const setupTask = (config: Record<string, unknown>) => {
    const task = {
      assigneeAgentId: 'agt_codex',
      config,
      id: 'task-1',
      identifier: 'T-1',
      status: 'backlog',
      totalTopics: 0,
    };
    taskModel = {
      findById: vi.fn().mockResolvedValue({ ...task, status: 'running' }),
      getCheckpointConfig: vi.fn().mockReturnValue({}),
      getReviewConfig: vi.fn().mockReturnValue(undefined),
      incrementTopicCount: vi.fn(),
      lockForUpdate: vi.fn().mockResolvedValue(true),
      resolve: vi.fn().mockResolvedValue({ ...task }),
      update: vi.fn(),
      updateCurrentTopic: vi.fn(),
      updateHeartbeat: vi.fn(),
      updateStatus: vi.fn(),
      updateStatusIfCurrent: vi.fn().mockResolvedValue({ ...task, status: 'running' }),
      updateTaskConfig: vi.fn(),
    };
    vi.mocked(TaskModel).mockImplementation(function () {
      return taskModel as any;
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(TaskTopicModel).mockImplementation(function () {
      return {
        add: vi.fn(),
        findByTaskId: vi.fn().mockResolvedValue([]),
        updateStatus: vi.fn(),
      } as any;
    });
    mocks.execAgent.mockResolvedValue({ operationId: 'op-1', success: true, topicId: 'tpc-1' });
    mocks.getAgentModelConfig.mockResolvedValue({ model: 'codex', provider: 'openai' });
    mocks.getAgentAgencyConfig.mockResolvedValue({ heterogeneousProvider: { type: 'codex' } });
  });

  it('keeps a legacy model-only override and fills only its native provider', async () => {
    setupTask({ model: 'gpt-5.4' });

    await new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' });

    expect(taskModel.updateTaskConfig).toHaveBeenCalledWith('task-1', { provider: 'codex' });
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4', provider: 'codex' }),
    );
  });

  it('snapshots the Agent model when the Task has none', async () => {
    setupTask({});

    await new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' });

    expect(taskModel.updateTaskConfig).toHaveBeenCalledWith('task-1', {
      model: 'codex',
      provider: 'openai',
    });
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'codex', provider: 'openai' }),
    );
  });
});
