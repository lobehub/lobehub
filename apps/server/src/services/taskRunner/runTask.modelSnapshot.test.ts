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
      findById: vi
        .fn()
        .mockResolvedValueOnce({ ...task })
        .mockResolvedValue({ ...task, status: 'running' }),
      getCheckpointConfig: vi.fn().mockReturnValue({}),
      getReviewConfig: vi.fn().mockReturnValue(undefined),
      incrementTopicCount: vi.fn(),
      lockForUpdate: vi.fn().mockResolvedValue(true),
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
  // ROOT CAUSE:
  // API auth has no native provider; falling back to codex/openai's wrapper
  // provider makes resolveRunAgentConfig replace the personal API binding.
  /** @example A legacy API model-only Task retains its personal provider ID. */
  it('backfills an API model-only Task with the configured personal binding', async () => {
    setupTask({ model: 'gpt-5.4-mini' });
    mocks.getAgentAgencyConfig.mockResolvedValue({
      heterogeneousProvider: {
        authMode: 'api',
        type: 'codex',
        apiConfig: { model: 'gpt-5.4', providerId: 'personal-provider' },
      },
    });
    await new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' });
    /** @example Backfill never introduces the wrapper provider as a binding ID. */
    expect(taskModel.updateTaskConfig).toHaveBeenCalledWith('task-1', {
      provider: 'personal-provider',
    });
    /** @example The run receives the requested model and the original binding together. */
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.4-mini',
        provider: 'personal-provider',
      }),
    );
  });

  /** @example Missing API configuration remains missing rather than becoming an openai binding. */
  it('does not manufacture a personal provider when API configuration is absent', async () => {
    setupTask({ model: 'gpt-5.4-mini' });
    mocks.getAgentAgencyConfig.mockResolvedValue({
      heterogeneousProvider: { authMode: 'api', type: 'codex' },
    });
    await new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' });
    /** @example The resolver receives no inferred provider and leaves the invalid binding to its guard. */
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4-mini' }),
    );
    /** @example No wrapper provider is attached to the dispatched call. */
    expect(mocks.execAgent.mock.calls[0][0]).not.toHaveProperty('provider');
  });

  // ROOT CAUSE:
  // The pin written at creation never follows the Agent, and run had no way to
  // replace it, so every retry kept dispatching the model the provider rejected.
  /** @example An explicit pair replaces a stale pin for this run and later ones. */
  it('replaces a stale pinned model with an explicit model and provider', async () => {
    setupTask({ model: 'stale-model', provider: 'blocked-provider' });
    mocks.getAgentAgencyConfig.mockResolvedValue({});

    await new TaskRunnerService(db, 'user-1').runTask({
      model: 'fixed-model',
      provider: 'working-provider',
      taskId: 'T-1',
    });

    expect(taskModel.updateTaskConfig).toHaveBeenCalledWith('task-1', {
      model: 'fixed-model',
      provider: 'working-provider',
    });
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fixed-model', provider: 'working-provider' }),
    );
  });

  /** @example A model-only override never inherits the provider of the model it replaces. */
  it('resolves a model-only override without keeping the stale provider', async () => {
    setupTask({ model: 'stale-model', provider: 'blocked-provider' });
    mocks.getAgentModelConfig.mockResolvedValue({
      model: 'agent-model',
      provider: 'agent-provider',
    });
    mocks.getAgentAgencyConfig.mockResolvedValue({});

    await new TaskRunnerService(db, 'user-1').runTask({ model: 'fixed-model', taskId: 'T-1' });

    expect(taskModel.updateTaskConfig).toHaveBeenCalledTimes(1);
    expect(taskModel.updateTaskConfig).toHaveBeenCalledWith('task-1', {
      model: 'fixed-model',
      provider: 'agent-provider',
    });
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fixed-model', provider: 'agent-provider' }),
    );
  });

  /** @example A replacement that cannot start leaves the previous pin in place. */
  it('keeps the previous pin when the replacement run fails to start', async () => {
    setupTask({ model: 'stale-model', provider: 'blocked-provider' });
    mocks.getAgentAgencyConfig.mockResolvedValue({});
    mocks.execAgent.mockResolvedValue({ error: 'unknown model', success: false });

    await expect(
      new TaskRunnerService(db, 'user-1').runTask({
        model: 'typo-model',
        provider: 'working-provider',
        taskId: 'T-1',
      }),
    ).rejects.toThrow('unknown model');

    expect(taskModel.updateTaskConfig).not.toHaveBeenCalled();
  });

  /** @example A pair the runtime would silently ignore is refused before dispatch. */
  it('refuses a pair a heterogeneous runtime cannot use', async () => {
    setupTask({ model: 'stale-model', provider: 'codex' });

    await expect(
      new TaskRunnerService(db, 'user-1').runTask({
        model: 'gpt-5.4',
        provider: 'openai',
        taskId: 'T-1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mocks.execAgent).not.toHaveBeenCalled();
    expect(taskModel.updateTaskConfig).not.toHaveBeenCalled();
  });

  /** @example Without an override the run keeps the pinned pair and writes nothing. */
  it('keeps the pinned pair when no override is passed', async () => {
    setupTask({ model: 'pinned-model', provider: 'pinned-provider' });

    await new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' });

    expect(taskModel.updateTaskConfig).not.toHaveBeenCalled();
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'pinned-model', provider: 'pinned-provider' }),
    );
  });
});
