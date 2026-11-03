// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { RbacModel } from '@/database/models/rbac';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';

import { TaskService } from './index';

const { cancelScheduled, scheduleNextTopic, trashTasksInTransaction } = vi.hoisted(() => ({
  cancelScheduled: vi.fn(),
  scheduleNextTopic: vi.fn(),
  trashTasksInTransaction: vi.fn(),
}));

vi.mock('../trash', () => ({ trashTasksInTransaction }));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(),
  taskActivityActor: (actor: { agentId?: string | null; userId?: string | null }) => ({
    actorAgentId: actor.agentId ?? null,
    actorKind: actor.agentId ? 'agent' : actor.userId ? 'user' : 'system',
    actorUserId: actor.agentId ? null : (actor.userId ?? null),
  }),
}));

const { findGoalByTaskId } = vi.hoisted(() => ({
  findGoalByTaskId: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/database/models/goalGraph', () => ({
  GoalGraphModel: vi.fn().mockImplementation(function () {
    return { findGoalByTaskId };
  }),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(),
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: vi.fn(),
}));

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findByIds: vi.fn().mockResolvedValue([]) },
}));

const { resolveTaskAcceptance } = vi.hoisted(() => ({
  resolveTaskAcceptance: vi.fn(),
}));

vi.mock('@/server/services/verify/taskAcceptanceResolution', () => ({ resolveTaskAcceptance }));

// AiAgentService pulls in ~14 sub-dependencies in its constructor; mock it so
// the running-status branch in updateStatus doesn't drag them in.
const { interruptTaskMock } = vi.hoisted(() => ({ interruptTaskMock: vi.fn() }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return {
      interruptTask: interruptTaskMock,
    };
  }),
}));

vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: () => ({ cancelScheduled, scheduleNextTopic }),
}));

// Attachment resolver hits FileModel + DocumentService + FileService — stub it
// out so getTaskDetail tests don't need a real file pipeline.
vi.mock('@/server/services/file/resolveAttachments', () => ({
  resolveAttachmentMetadata: vi.fn().mockResolvedValue([]),
}));

describe('TaskService.deleteTask', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockAgentModel = {
    existsById: vi.fn().mockResolvedValue(true),
    getAgentAvatarsByIds: vi.fn().mockResolvedValue([]),
    getAgentModelConfig: vi.fn().mockResolvedValue(null),
    getAgentSnapshotForTaskCreate: vi
      .fn()
      .mockResolvedValue({ snapshot: null, visibility: 'public' }),
    getAgentVisibility: vi.fn().mockResolvedValue('public'),
  };

  const mockTaskModel = {
    addActivities: vi.fn(),
    addActivity: vi.fn(),
    findSubtasks: vi.fn(),
    lockForStatusChange: vi.fn(),
    updateStatusForIds: vi.fn(),
    updateWithLog: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteIfStatus: vi.fn().mockResolvedValue(true),
    lockForUpdate: vi.fn().mockResolvedValue(true),
    findById: vi.fn(),
    findByIds: vi.fn(),
    findAllDescendants: vi.fn(),
    getActivities: vi.fn().mockResolvedValue([]),
    getCheckpointConfig: vi.fn(),
    getComments: vi.fn(),
    getCommentFileIdsMap: vi.fn().mockResolvedValue({}),
    getDependencies: vi.fn(),
    getDependenciesByTaskIds: vi.fn().mockResolvedValue([]),
    getReviewConfig: vi.fn(),
    getVerifyConfig: vi.fn(),
    getTaskFileIds: vi.fn().mockResolvedValue([]),
    getTreeAgentIdsForTaskIds: vi.fn().mockResolvedValue({}),
    getTreePinnedDocuments: vi.fn(),

    update: vi.fn(),
    updateContext: vi.fn(),
    updateStatus: vi.fn(),
  };

  const mockTaskTopicModel = {
    cancelIfRunning: vi.fn(),
    cancelRunningByTaskIds: vi.fn(),
    findByTaskId: vi.fn(),
    findRunningByTaskIds: vi.fn().mockResolvedValue([]),
    findWithHandoff: vi.fn(),
    findWithHandoffByTaskIds: vi.fn().mockResolvedValue([]),
    timeoutRunning: vi.fn(),
  };

  const mockTopicModel = {
    batchDeleteIncludingTrashed: vi.fn().mockResolvedValue(undefined),
  };

  const mockBriefModel = {
    findByTaskId: vi.fn(),
  };

  const mockRbacModel = {
    hasAnyPermission: vi.fn().mockResolvedValue(true),
  };

  const mockWorkspaceMemberModel = {
    getMember: vi.fn().mockResolvedValue({ role: 'member', userId: 'member-1' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    interruptTaskMock.mockReset().mockResolvedValue({ success: true });
    cancelScheduled.mockResolvedValue(undefined);
    scheduleNextTopic.mockResolvedValue('tick-new');
    resolveTaskAcceptance.mockResolvedValue(undefined);
    mockTaskTopicModel.findRunningByTaskIds.mockResolvedValue([]);
    mockTaskModel.getActivities.mockResolvedValue([]);
    mockTopicModel.batchDeleteIncludingTrashed.mockResolvedValue(undefined);
    (AgentModel as any).mockImplementation(function () {
      return mockAgentModel;
    });
    (TaskModel as any).mockImplementation(function () {
      return mockTaskModel;
    });
    (TaskTopicModel as any).mockImplementation(function () {
      return mockTaskTopicModel;
    });
    (TopicModel as any).mockImplementation(function () {
      return mockTopicModel;
    });
    (BriefModel as any).mockImplementation(function () {
      return mockBriefModel;
    });
    (RbacModel as any).mockImplementation(function () {
      return mockRbacModel;
    });
    (WorkspaceMemberModel as any).mockImplementation(function () {
      return mockWorkspaceMemberModel;
    });
  });

  describe('deleteTask', () => {
    beforeEach(() => {
      (db as any).transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
      mockTaskModel.lockForUpdate.mockResolvedValue(true);
      // Moves every target into the recycle bin unless a test says otherwise.
      trashTasksInTransaction.mockReset();
      trashTasksInTransaction.mockImplementation(
        async (_tx: unknown, _scope: unknown, targets: { taskId: string }[]) =>
          targets.map((target) => target.taskId),
      );
      mockTaskTopicModel.findByTaskId.mockResolvedValue([]);
    });

    it('interrupts a running execution before trashing the task', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-live',
        identifier: 'T-2',
        status: 'running',
      });
      mockTaskTopicModel.findRunningByTaskIds.mockResolvedValue([
        { operationId: 'op-live', status: 'running', taskId: 'task-live', topicId: 'topic-live' },
      ]);

      await new TaskService(db, userId).deleteTask('T-2');

      expect(interruptTaskMock).toHaveBeenCalledWith({ operationId: 'op-live' });
      expect(interruptTaskMock.mock.invocationCallOrder[0]).toBeLessThan(
        trashTasksInTransaction.mock.invocationCallOrder[0],
      );
      expect(trashTasksInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        { userId, workspaceId: undefined },
        [expect.objectContaining({ status: 'running', taskId: 'task-live' })],
      );
    });

    it('keeps the task when its execution cannot be stopped', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-live',
        identifier: 'T-2',
        status: 'running',
      });
      mockTaskTopicModel.findRunningByTaskIds.mockResolvedValue([
        { operationId: 'op-live', status: 'running', taskId: 'task-live', topicId: 'topic-live' },
      ]);
      interruptTaskMock.mockResolvedValueOnce({ success: false });

      await expect(new TaskService(db, userId).deleteTask('T-2')).rejects.toThrow(
        'Task interruption was not confirmed',
      );
      expect(trashTasksInTransaction).not.toHaveBeenCalled();
    });

    it('refuses to delete a task whose run is still starting', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-starting',
        identifier: 'T-4',
        startedAt: new Date(),
        status: 'running',
      });
      mockTaskTopicModel.findRunningByTaskIds.mockResolvedValue([]);

      await expect(new TaskService(db, userId).deleteTask('T-4')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(trashTasksInTransaction).not.toHaveBeenCalled();
    });

    it('deletes a running task whose start died long ago', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-stale',
        identifier: 'T-5',
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        status: 'running',
      });
      mockTaskTopicModel.findRunningByTaskIds.mockResolvedValue([]);

      await new TaskService(db, userId).deleteTask('T-5');

      expect(trashTasksInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        { userId, workspaceId: undefined },
        [expect.objectContaining({ status: 'running', taskId: 'task-stale' })],
      );
    });

    it('loses to a run that started after the checks instead of orphaning it', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-race',
        identifier: 'T-6',
        status: 'backlog',
      });
      trashTasksInTransaction.mockResolvedValueOnce([]);

      await expect(new TaskService(db, userId).deleteTask('T-6')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(trashTasksInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        { userId, workspaceId: undefined },
        [expect.objectContaining({ status: 'backlog', taskId: 'task-race' })],
      );
    });

    it('loses to a run that recorded a new topic while the delete was interrupting', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-cont',
        identifier: 'T-8',
        status: 'running',
      });
      const liveA = {
        operationId: 'op-a',
        status: 'running',
        taskId: 'task-cont',
        topicId: 'topic-a',
      };
      const continuedB = {
        operationId: 'op-b',
        status: 'running',
        taskId: 'task-cont',
        topicId: 'topic-b',
      };
      mockTaskTopicModel.findRunningByTaskIds
        .mockResolvedValueOnce([liveA])
        .mockResolvedValueOnce([liveA, continuedB]);

      await expect(new TaskService(db, userId).deleteTask('T-8')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(interruptTaskMock).toHaveBeenCalledWith({ operationId: 'op-a' });
      expect(mockTaskModel.lockForUpdate).toHaveBeenCalledWith('task-cont');
      expect(trashTasksInTransaction).not.toHaveBeenCalled();
    });

    it('treats a task already gone as deleted', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-gone',
        identifier: 'T-7',
        status: 'backlog',
      });
      mockTaskModel.lockForUpdate.mockResolvedValueOnce(false);

      await expect(new TaskService(db, userId).deleteTask('T-7')).resolves.toMatchObject({
        id: 'task-gone',
      });
      expect(trashTasksInTransaction).not.toHaveBeenCalled();
    });

    it("does not interrupt the caller's own run", async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-self',
        identifier: 'T-3',
        status: 'running',
      });
      mockTaskTopicModel.findRunningByTaskIds.mockResolvedValue([
        { operationId: 'op-self', status: 'running', taskId: 'task-self', topicId: 'topic-self' },
      ]);

      await new TaskService(db, userId).deleteTask('T-3', { keepOperationId: 'op-self' });

      expect(interruptTaskMock).not.toHaveBeenCalled();
      expect(trashTasksInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        { userId, workspaceId: undefined },
        [expect.objectContaining({ status: 'running', taskId: 'task-self' })],
      );
    });

    it('trashes the linked topics with the task, from the snapshot taken under the lock', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-topics',
        identifier: 'T-9',
        status: 'backlog',
      });
      mockTaskTopicModel.findByTaskId.mockResolvedValue([
        { status: 'completed', taskId: 'task-topics', topicId: 'topic-1' },
        { status: 'completed', taskId: 'task-topics', topicId: 'topic-2' },
      ]);

      await new TaskService(db, userId).deleteTask('T-9');

      // The topic rows have no FK back to the task: they go into the bin as its
      // children (restored with it), instead of lingering as sidebar orphans.
      expect(trashTasksInTransaction).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
        { status: 'backlog', taskId: 'task-topics', topicIds: ['topic-1', 'topic-2'] },
      ]);
      expect(mockTopicModel.batchDeleteIncludingTrashed).not.toHaveBeenCalled();
    });

    it('spares the kept operation topic when a task deletes itself mid-run', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-self-topics',
        identifier: 'T-12',
        status: 'running',
      });
      mockTaskTopicModel.findRunningByTaskIds.mockResolvedValue([
        {
          operationId: 'op-self',
          status: 'running',
          taskId: 'task-self-topics',
          topicId: 'topic-live',
        },
      ]);
      mockTaskTopicModel.findByTaskId.mockResolvedValue([
        {
          operationId: 'op-self',
          status: 'running',
          taskId: 'task-self-topics',
          topicId: 'topic-live',
        },
        { status: 'completed', taskId: 'task-self-topics', topicId: 'topic-old' },
      ]);

      await new TaskService(db, userId).deleteTask('T-12', { keepOperationId: 'op-self' });

      // The live run's topic must survive with its operation — it stays out of
      // the bin, so the still-running tool call keeps its conversation.
      expect(trashTasksInTransaction).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
        { status: 'running', taskId: 'task-self-topics', topicIds: ['topic-old'] },
      ]);
    });

    it('trashes the task alone when it has no topics', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-bare',
        identifier: 'T-10',
        status: 'backlog',
      });
      mockTaskTopicModel.findByTaskId.mockResolvedValue([]);

      await new TaskService(db, userId).deleteTask('T-10');

      expect(trashTasksInTransaction).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
        { status: 'backlog', taskId: 'task-bare', topicIds: [] },
      ]);
    });

    it('reports a conflict when the status CAS loses the race', async () => {
      mockTaskModel.findById.mockResolvedValue({
        id: 'task-race-topics',
        identifier: 'T-11',
        status: 'backlog',
      });
      mockTaskTopicModel.findByTaskId.mockResolvedValue([
        { status: 'completed', taskId: 'task-race-topics', topicId: 'topic-race' },
      ]);
      trashTasksInTransaction.mockResolvedValueOnce([]);

      await expect(new TaskService(db, userId).deleteTask('T-11')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(mockTopicModel.batchDeleteIncludingTrashed).not.toHaveBeenCalled();
      expect(mockTaskModel.deleteIfStatus).not.toHaveBeenCalled();
    });
  });
});
