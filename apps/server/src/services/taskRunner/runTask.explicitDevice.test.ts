import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';

import { TaskRunnerService } from './index';

const mocks = vi.hoisted(() => ({
  execAgent: vi.fn(),
  findTopicById: vi.fn(),
  getAgentAgencyConfig: vi.fn(),
  getAgentModelConfig: vi.fn(),
  interruptTask: vi.fn(),
  updateTopicMetadata: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn() }));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return { findById: mocks.findTopicById, updateMetadata: mocks.updateTopicMetadata };
  }),
}));
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
    return { execAgent: mocks.execAgent, interruptTask: mocks.interruptTask };
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

// The scheduler picks a machine by load and dispatches `lh task run --device`;
// a task bound to another machine in its detail page must not silently win.
describe('TaskRunnerService.runTask explicit device', () => {
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as any;

  const pinnedToA = {
    execution: {
      boundDeviceId: 'device-a',
      workingDirectory: '/a/project',
      workingDirectoryConfig: { path: '/a/project' },
    },
    model: 'codex',
    provider: 'openai',
  };

  const setupTask = (config: Record<string, unknown>) => {
    const task = {
      assigneeAgentId: 'agt_codex',
      config,
      id: 'task-1',
      identifier: 'T-1',
      status: 'backlog',
      totalTopics: 0,
    };
    const taskModel = {
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
    return taskModel;
  };

  const run = (params: { continueTopicId?: string; deviceId?: string } = {}) =>
    new TaskRunnerService(db, 'user-1', 'ws-1').runTask({ taskId: 'T-1', ...params });

  const execParams = () => mocks.execAgent.mock.calls[0][0];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(TaskTopicModel).mockImplementation(function () {
      return {
        add: vi.fn(),
        findByTaskId: vi.fn().mockResolvedValue([]),
        updateOperationId: vi.fn(),
        updateStatus: vi.fn(),
      } as any;
    });
    mocks.execAgent.mockResolvedValue({ operationId: 'op-1', success: true, topicId: 'tpc-1' });
    mocks.getAgentModelConfig.mockResolvedValue({ model: 'codex', provider: 'openai' });
    mocks.getAgentAgencyConfig.mockResolvedValue({
      executionTarget: 'device',
    } satisfies LobeAgentAgencyConfig);
  });

  it("runs on the requested device without the pinned machine's directory", async () => {
    setupTask(pinnedToA);

    await run({ deviceId: 'device-b' });

    expect(execParams().deviceId).toBe('device-b');
    expect(execParams().appContext?.initialTopicMetadata).toBeUndefined();
  });

  it('keeps the task pin and its directory when no device is requested', async () => {
    setupTask(pinnedToA);

    await run();

    expect(execParams().deviceId).toBe('device-a');
    expect(execParams().appContext?.initialTopicMetadata).toEqual({
      workingDirectory: '/a/project',
      workingDirectoryConfig: { path: '/a/project' },
    });
  });

  it('forwards the requested device for a task that pins nothing', async () => {
    setupTask({ model: 'codex', provider: 'openai' });

    await run({ deviceId: 'device-b' });

    expect(execParams().deviceId).toBe('device-b');
  });

  it("keeps the agent's fixed target in charge of the directory", async () => {
    setupTask(pinnedToA);
    mocks.getAgentAgencyConfig.mockResolvedValue({
      boundDeviceId: 'device-c',
      executionTarget: 'device',
      executionTargetSelectionPolicy: 'fixed',
    } satisfies LobeAgentAgencyConfig);

    await run({ deviceId: 'device-b' });

    // `turnSetup` drops any requested device under a fixed policy and routes to
    // device-c, so neither A's directory nor the request may decide anything here.
    expect(execParams().appContext?.initialTopicMetadata).toBeUndefined();
  });

  it('moves a continued topic to the requested device before dispatching', async () => {
    setupTask(pinnedToA);
    mocks.findTopicById.mockResolvedValue({
      id: 'tpc-old',
      metadata: {
        boundDeviceId: 'device-a',
        workingDirectory: '/a/project',
        workingDirectoryConfig: { path: '/a/project' },
      },
    });

    await run({ continueTopicId: 'tpc-old', deviceId: 'device-b' });

    expect(mocks.updateTopicMetadata).toHaveBeenCalledWith('tpc-old', {
      boundDeviceId: 'device-b',
      repos: undefined,
      workingDirectory: undefined,
      workingDirectoryConfig: undefined,
    });
    expect(execParams().deviceId).toBe('device-b');
  });

  describe('when a continued kickoff on the requested device fails', () => {
    const previous = {
      boundDeviceId: 'device-a',
      workingDirectory: '/a/project',
      workingDirectoryConfig: { path: '/a/project' },
    };

    beforeEach(() => {
      setupTask(pinnedToA);
      mocks.findTopicById.mockResolvedValue({ id: 'tpc-old', metadata: previous });
    });

    const expectRestored = () =>
      expect(mocks.updateTopicMetadata).toHaveBeenLastCalledWith(
        'tpc-old',
        { ...previous, repos: undefined },
        { onlyIf: expect.any(Function) },
      );

    it("restores only while the topic still carries this run's retarget", async () => {
      mocks.execAgent.mockResolvedValue({ error: 'device offline', success: false });

      await expect(run({ continueTopicId: 'tpc-old', deviceId: 'device-b' })).rejects.toThrow();

      const { onlyIf } = mocks.updateTopicMetadata.mock.lastCall![2];
      expect(onlyIf({ boundDeviceId: 'device-b', model: 'codex' })).toBe(true);
      // Someone moved the topic while the kickoff was in flight: theirs is newer.
      expect(onlyIf({ boundDeviceId: 'device-d' })).toBe(false);
      expect(onlyIf({ boundDeviceId: 'device-b', workingDirectory: '/b/other' })).toBe(false);
    });

    it('restores the topic when the task is withdrawn and the run is confirmed stopped', async () => {
      const taskModel = setupTask(pinnedToA);
      taskModel.lockForUpdate.mockResolvedValue(false);
      mocks.interruptTask.mockResolvedValue({ success: true });

      await expect(run({ continueTopicId: 'tpc-old', deviceId: 'device-b' })).rejects.toThrow(
        'the run was stopped',
      );

      expect(mocks.updateTopicMetadata).toHaveBeenCalledTimes(2);
      expectRestored();
    });

    it('keeps the retarget when stopping the withdrawn run is not confirmed', async () => {
      const taskModel = setupTask(pinnedToA);
      taskModel.lockForUpdate.mockResolvedValue(false);
      mocks.interruptTask.mockResolvedValue({ success: false });

      await expect(run({ continueTopicId: 'tpc-old', deviceId: 'device-b' })).rejects.toThrow(
        'could not be confirmed',
      );

      expect(mocks.updateTopicMetadata).toHaveBeenCalledTimes(1);
    });

    it('restores the topic when dispatch is not accepted', async () => {
      mocks.execAgent.mockResolvedValue({ error: 'device offline', success: false });

      await expect(run({ continueTopicId: 'tpc-old', deviceId: 'device-b' })).rejects.toThrow(
        'device offline',
      );

      expectRestored();
    });

    it('restores the topic when dispatch throws', async () => {
      mocks.execAgent.mockRejectedValue(new Error('boom'));

      await expect(run({ continueTopicId: 'tpc-old', deviceId: 'device-b' })).rejects.toThrow(
        'boom',
      );

      expectRestored();
    });

    it('keeps the retarget when bookkeeping fails after a successful dispatch', async () => {
      const taskModel = setupTask(pinnedToA);
      taskModel.lockForUpdate.mockRejectedValue(new Error('db down'));

      await expect(run({ continueTopicId: 'tpc-old', deviceId: 'device-b' })).rejects.toThrow(
        'db down',
      );

      // The operation may be live on device-b, so the topic must stay there.
      expect(mocks.updateTopicMetadata).toHaveBeenCalledTimes(1);
    });

    it('keeps the retarget once the run is accepted', async () => {
      await run({ continueTopicId: 'tpc-old', deviceId: 'device-b' });

      expect(mocks.updateTopicMetadata).toHaveBeenCalledTimes(1);
    });
  });

  it('does not move a continued topic to a device the fixed target replaces', async () => {
    setupTask(pinnedToA);
    mocks.getAgentAgencyConfig.mockResolvedValue({
      boundDeviceId: 'device-c',
      executionTarget: 'device',
      executionTargetSelectionPolicy: 'fixed',
    } satisfies LobeAgentAgencyConfig);
    mocks.findTopicById.mockResolvedValue({
      id: 'tpc-old',
      metadata: { boundDeviceId: 'device-a' },
    });

    await run({ continueTopicId: 'tpc-old', deviceId: 'device-b' });

    expect(mocks.updateTopicMetadata).not.toHaveBeenCalled();
    expect(execParams().deviceId).toBe('device-a');
  });

  it('does not move a continued topic to a device the fixed target replaces after its selection was cleared', async () => {
    // A cleared selection is still persisted (as `null` axes), so the topic sync
    // runs even though the task pins nothing.
    setupTask({
      execution: { boundDeviceId: null, workingDirectory: null },
      model: 'codex',
      provider: 'openai',
    });
    mocks.getAgentAgencyConfig.mockResolvedValue({
      boundDeviceId: 'device-c',
      executionTarget: 'device',
      executionTargetSelectionPolicy: 'fixed',
    } satisfies LobeAgentAgencyConfig);
    mocks.findTopicById.mockResolvedValue({ id: 'tpc-old', metadata: {} });

    await run({ continueTopicId: 'tpc-old', deviceId: 'device-b' });

    expect(mocks.updateTopicMetadata).not.toHaveBeenCalled();
    expect(execParams().deviceId).toBeUndefined();
  });
});
