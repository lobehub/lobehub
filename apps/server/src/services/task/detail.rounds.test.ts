// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailService } from './detail';

const mocks = vi.hoisted(() => ({
  agent: { getAgentAvatarsByIds: vi.fn() },
  task: {
    findAllDescendants: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    getActivities: vi.fn(),
    getCheckpointConfig: vi.fn(),
    getComments: vi.fn(),
    getDependencies: vi.fn(),
    getDependenciesByTaskIds: vi.fn(),
    getTreePinnedDocuments: vi.fn(),
    getVerifyConfig: vi.fn(),
  },
  taskTopic: {
    findRunningByTaskIds: vi.fn(),
    findWithHandoff: vi.fn(),
    findWithHandoffByTaskIds: vi.fn(),
  },
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return mocks.agent;
  }),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return mocks.task;
  }),
}));
vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(function () {
    return mocks.taskTopic;
  }),
}));
vi.mock('@/database/models/goalGraph', () => ({
  GoalGraphModel: vi.fn(function () {
    return { findGoalByTaskId: vi.fn().mockResolvedValue(undefined) };
  }),
}));
vi.mock('@/database/models/taskLabel', () => ({
  TaskLabelModel: vi.fn(function () {
    return { getTaskLabels: vi.fn().mockResolvedValue([]) };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperations: vi.fn().mockResolvedValue(new Map()) };
  }),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: { findByIds: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/database/models/workspaceMember', () => ({ WorkspaceMemberModel: vi.fn() }));
vi.mock('../file/extractFileIdsFromEditorData', () => ({
  extractFileIdsFromEditorData: vi.fn().mockResolvedValue([]),
}));
vi.mock('../file/resolveAttachments', () => ({
  resolveAttachmentMetadata: vi.fn().mockResolvedValue([]),
}));
vi.mock('../verify/taskAcceptanceResolution', () => ({
  resolveTaskAcceptance: vi.fn().mockResolvedValue(undefined),
}));

const root = {
  assigneeAgentId: 'agt_root',
  config: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  createdByUserId: 'user_1',
  id: 'task_root',
  identifier: 'T-10',
  name: 'Root',
  parentTaskId: 'task_parent',
  status: 'backlog',
};
const child = {
  assigneeAgentId: 'agt_child',
  id: 'task_child',
  identifier: 'T-11',
  name: 'Child',
  parentTaskId: 'task_root',
  status: 'backlog',
};
const parentTask = { assigneeAgentId: null, id: 'task_parent', identifier: 'T-9', name: 'Parent' };

describe('TaskDetailService.getTaskDetail round trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.task.findById.mockImplementation(async (id: string) =>
      id === 'task_parent' ? parentTask : id === 'task_root' ? root : null,
    );
    mocks.task.findAllDescendants.mockResolvedValue([child]);
    mocks.task.getDependencies.mockResolvedValue([{ dependsOnId: 'task_dep', type: 'blocks' }]);
    mocks.task.findByIds.mockResolvedValue([{ id: 'task_dep', identifier: 'T-5', name: 'Dep' }]);
    mocks.task.getActivities.mockResolvedValue([]);
    mocks.task.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
    mocks.task.getDependenciesByTaskIds.mockResolvedValue([]);
    mocks.task.getCheckpointConfig.mockReturnValue(undefined);
    mocks.task.getVerifyConfig.mockReturnValue(undefined);
    mocks.taskTopic.findWithHandoff.mockResolvedValue([]);
    mocks.taskTopic.findWithHandoffByTaskIds.mockResolvedValue([]);
    mocks.taskTopic.findRunningByTaskIds.mockResolvedValue([]);
    mocks.agent.getAgentAvatarsByIds.mockResolvedValue([]);
  });

  it('starts dependent reads without waiting for the slowest first read', async () => {
    // Comments stay pending until every dependent read has been issued: with a
    // staged waterfall the parent / dependency / descendant reads would wait for
    // this batch and the call would never settle.
    let releaseComments!: () => void;
    mocks.task.getComments.mockReturnValue(
      new Promise((resolve) => {
        releaseComments = () => resolve([]);
      }),
    );
    const service = new TaskDetailService({} as never, 'user_1');
    const pending = service.getTaskDetail('task_root', root as never);

    await vi.waitFor(() => {
      expect(mocks.task.findById).toHaveBeenCalledWith('task_parent');
      expect(mocks.task.findByIds).toHaveBeenCalledWith(['task_dep']);
      expect(mocks.taskTopic.findWithHandoffByTaskIds).toHaveBeenCalledWith(
        ['task_child'],
        expect.any(Number),
      );
      expect(mocks.agent.getAgentAvatarsByIds).toHaveBeenCalledWith(['agt_child']);
    });
    releaseComments();

    const detail = await pending;
    expect(detail?.parent).toMatchObject({ id: 'task_parent', identifier: 'T-9' });
    expect(detail?.dependencies).toEqual([
      { dependsOn: 'T-5', dependsOnId: 'task_dep', name: 'Dep', type: 'blocks' },
    ]);
    expect(detail?.subtasks.map((s) => s.identifier)).toEqual(['T-11']);
  });

  it('does not read the task row again when the caller already has it', async () => {
    mocks.task.getComments.mockResolvedValue([]);
    const service = new TaskDetailService({} as never, 'user_1');

    await service.getTaskDetail('task_root', root as never);

    expect(mocks.task.findById).not.toHaveBeenCalledWith('task_root');
  });
});
