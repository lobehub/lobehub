// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskService } from './index';

/**
 * Task detail reads that change state or decorate rows: the heartbeat-timeout
 * auto-pause, clearing its stale error, and the verify verdict on run rows.
 */
const mocks = vi.hoisted(() => ({
  findByOperations: vi.fn(),
  findWithHandoff: vi.fn(),
  findById: vi.fn(),
  timeoutRunning: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentAvatarsByIds: vi.fn().mockResolvedValue([]) };
  }),
}));
vi.mock('@/database/models/project', () => ({ ProjectModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: { findByIds: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/database/models/goalGraph', () => ({
  GoalGraphModel: vi.fn(function () {
    return { findGoalByTaskId: vi.fn().mockResolvedValue(undefined) };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperations: mocks.findByOperations };
  }),
}));
vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(function () {
    return {
      findWithHandoff: mocks.findWithHandoff,
      timeoutRunning: mocks.timeoutRunning,
    };
  }),
}));
vi.mock('@/database/models/task', () => ({
  taskActivityActor: vi.fn(),
  TaskModel: vi.fn(function () {
    return {
      findAllDescendants: vi.fn().mockResolvedValue([]),
      findByIds: vi.fn().mockResolvedValue([]),
      getActivities: vi.fn().mockResolvedValue([]),
      getCheckpointConfig: vi.fn().mockReturnValue({}),
      getComments: vi.fn().mockResolvedValue([]),
      getDependencies: vi.fn().mockResolvedValue([]),
      getTreePinnedDocuments: vi.fn().mockResolvedValue({ nodeMap: {}, tree: [] }),
      getVerifyConfig: vi.fn().mockReturnValue(undefined),
      findById: mocks.findById,
      update: mocks.update,
      updateStatus: mocks.updateStatus,
    };
  }),
}));
vi.mock('@/server/services/verify/taskAcceptance', () => ({
  resolveTaskAcceptance: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('@/server/services/file/resolveAttachments', () => ({
  resolveAttachmentMetadata: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/server/services/file/extractFileIdsFromEditorData', () => ({
  extractFileIdsFromEditorData: vi.fn().mockResolvedValue([]),
}));

const baseTask = {
  assigneeAgentId: null,
  createdAt: null,
  error: null,
  id: 'task-1',
  identifier: 'T-1',
  parentTaskId: null,
  status: 'todo',
};

const service = () => new TaskService({} as any, 'user-1');

describe('TaskService.getTaskDetail state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findWithHandoff.mockResolvedValue([]);
    mocks.findByOperations.mockResolvedValue(new Map());
  });

  it('pauses a running task whose heartbeat timed out, then re-reads it', async () => {
    const stale = {
      ...baseTask,
      heartbeatTimeout: 60,
      lastHeartbeatAt: new Date(Date.now() - 120_000),
      status: 'running',
    };
    mocks.findById
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce({ ...stale, error: 'Heartbeat timeout', status: 'paused' });

    const detail = await service().getTaskDetail('T-1');

    expect(mocks.updateStatus).toHaveBeenCalledWith('task-1', 'paused', {
      error: 'Heartbeat timeout',
    });
    expect(mocks.timeoutRunning).toHaveBeenCalledWith('task-1');
    expect(mocks.findById).toHaveBeenCalledTimes(2);
    // The re-read task is no longer running, so its timeout error is cleared.
    expect(mocks.update).toHaveBeenCalledWith('task-1', { error: null });
    expect(detail).toMatchObject({ error: null, status: 'paused' });
  });

  it('keeps a running task whose heartbeat is still fresh', async () => {
    mocks.findById.mockResolvedValue({
      ...baseTask,
      heartbeatTimeout: 600,
      lastHeartbeatAt: new Date(),
      status: 'running',
    });

    await service().getTaskDetail('T-1');

    expect(mocks.updateStatus).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("decorates each run row with its verify round's verdict", async () => {
    mocks.findById.mockResolvedValue(baseTask);
    mocks.findWithHandoff.mockResolvedValue([
      {
        createdAt: new Date('2024-01-02T00:00:00Z'),
        operationId: 'op-1',
        seq: 1,
        status: 'completed',
        topicId: 'topic-1',
      },
      {
        createdAt: new Date('2024-01-03T00:00:00Z'),
        operationId: null,
        seq: 2,
        status: 'running',
        topicId: 'topic-2',
      },
    ]);
    mocks.findByOperations.mockResolvedValue(
      new Map([
        [
          'op-1',
          {
            acceptanceId: 'acc-1',
            id: 'run-1',
            passed: 3,
            roundIndex: 2,
            status: 'passed',
            total: 4,
          },
        ],
      ]),
    );

    const detail = await service().getTaskDetail('T-1');

    expect(mocks.findByOperations).toHaveBeenCalledWith(['op-1']);
    expect(detail?.activities?.map((activity) => [activity.id, activity.verify])).toEqual([
      [
        'topic-1',
        {
          acceptanceId: 'acc-1',
          passed: 3,
          roundIndex: 2,
          runId: 'run-1',
          status: 'passed',
          total: 4,
        },
      ],
      ['topic-2', null],
    ]);
  });
});
