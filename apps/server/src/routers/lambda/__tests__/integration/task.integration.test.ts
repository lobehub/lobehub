// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';

import { taskRouter } from '../../task';
import {
  cleanupTestUser,
  createTestAgent,
  createTestContext,
  createTestTopic,
  createTestUser,
} from './setup';

// Mock getServerDB
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock AiAgentService
const mockExecAgent = vi.fn().mockResolvedValue({
  operationId: 'op_test',
  success: true,
  topicId: 'tpc_test',
});
const mockInterruptTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execAgent: mockExecAgent,
    interruptTask: mockInterruptTask,
  })),
}));

// Mock TaskLifecycleService
vi.mock('@/server/services/taskLifecycle', () => ({
  TaskLifecycleService: vi.fn().mockImplementation(() => ({
    onTopicComplete: vi.fn(),
  })),
}));

// Mock TaskReviewService
vi.mock('@/server/services/taskReview', () => ({
  TaskReviewService: vi.fn().mockImplementation(() => ({
    review: vi.fn(),
  })),
}));

// Mock initModelRuntimeFromDB
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

// Mock the assignment-notification business slot (default impl is a no-op;
// the router must fire it only on an actual assignee change to someone else).
const mockNotifyTaskAssigned = vi.fn().mockResolvedValue(undefined);
vi.mock('@/business/server/task/notifyTaskAssigned', () => ({
  notifyTaskAssigned: (...args: unknown[]) => mockNotifyTaskAssigned(...args),
}));

// Mock the comment-notification business slot (default impl is a no-op).
const mockNotifyTaskCommentActivity = vi.fn().mockResolvedValue(undefined);
vi.mock('@/business/server/task/notifyTaskCommentActivity', () => ({
  notifyTaskCommentActivity: (...args: unknown[]) => mockNotifyTaskCommentActivity(...args),
}));

// Notifications are retained past the response through `after()`; run that
// work eagerly here and flush it before asserting on the slots above.
const afterResponseTasks = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => unknown) => void afterResponseTasks.push(Promise.resolve().then(work)),
}));
const flushAfterResponse = async () => {
  while (afterResponseTasks.length > 0) await Promise.all(afterResponseTasks.splice(0));
};

describe('Task Router Integration', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let otherUserId: string | undefined;
  let testAgentId: string;
  let testTopicId: string;
  let caller: ReturnType<typeof taskRouter.createCaller>;

  beforeEach(async () => {
    vi.clearAllMocks();
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    testAgentId = await createTestAgent(serverDB, userId, 'agt_test');
    testTopicId = await createTestTopic(serverDB, userId, 'tpc_test');
    // Update mock to return the real topic ID
    mockExecAgent.mockResolvedValue({
      operationId: 'op_test',
      success: true,
      topicId: testTopicId,
    });
    caller = taskRouter.createCaller(createTestContext(userId));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    if (otherUserId) await cleanupTestUser(serverDB, otherUserId);
    otherUserId = undefined;
  });

  describe('create + find + detail', () => {
    it('should create a task and retrieve it', async () => {
      const result = await caller.create({
        instruction: 'Write a book',
        name: 'Write Book',
      });

      expect(result.data.identifier).toBe('T-1');
      expect(result.data.name).toBe('Write Book');
      expect(result.data.status).toBe('backlog');

      // find
      const found = await caller.find({ id: 'T-1' });
      expect(found.data.id).toBe(result.data.id);

      // detail
      const detail = await caller.detail({ id: 'T-1' });
      expect(detail.data.identifier).toBe('T-1');
      expect(detail.data.subtasks).toHaveLength(0);
      // A "created" activity is auto-generated from task.createdAt
      expect(detail.data.activities).toHaveLength(1);
      expect(detail.data.activities![0].type).toBe('created');
      expect(detail.data.activities![0].author?.type).toBe('user');
    });

    it('should persist createdByAgentId when provided (agent-created task)', async () => {
      const result = await caller.create({
        createdByAgentId: testAgentId,
        instruction: 'Created by agent tool',
        name: 'Agent Task',
      });

      expect(result.data.createdByAgentId).toBe(testAgentId);
      expect(result.data.createdByUserId).toBe(userId);
    });

    it('should leave createdByAgentId null when omitted (UI-created task)', async () => {
      const result = await caller.create({
        instruction: 'Created via UI',
        name: 'UI Task',
      });

      expect(result.data.createdByAgentId).toBeNull();
      expect(result.data.createdByUserId).toBe(userId);
    });

    it('should reject assigneeAgentId from another user when creating', async () => {
      otherUserId = await createTestUser(serverDB);
      const otherAgentId = await createTestAgent(serverDB, otherUserId);

      await expect(
        caller.create({
          assigneeAgentId: otherAgentId,
          instruction: 'Cross-user assignment',
          name: 'Cross-user Task',
        }),
      ).rejects.toThrow('Assignee agent not found');
    });

    it('should reject assigneeAgentId from another user when updating', async () => {
      otherUserId = await createTestUser(serverDB);
      const otherAgentId = await createTestAgent(serverDB, otherUserId);
      const task = await caller.create({
        instruction: 'Created via UI',
        name: 'UI Task',
      });

      await expect(
        caller.update({
          assigneeAgentId: otherAgentId,
          id: task.data.id,
        }),
      ).rejects.toThrow('Assignee agent not found');
    });

    it('should clear stale editorData for instruction-only updates', async () => {
      const task = await caller.create({
        editorData: { root: { children: [{ text: 'Old instruction' }] } },
        instruction: 'Old instruction',
        name: 'Editable task',
      });

      const instructionOnlyUpdate = await caller.update({
        id: task.data.id,
        instruction: 'New instruction',
      });

      expect(instructionOnlyUpdate.data.instruction).toBe('New instruction');
      expect(instructionOnlyUpdate.data.editorData).toBeNull();

      const nextEditorData = { root: { children: [{ text: 'Rich instruction' }] } };
      const richTextUpdate = await caller.update({
        editorData: nextEditorData,
        id: task.data.id,
        instruction: 'Rich instruction',
      });

      expect(richTextUpdate.data.instruction).toBe('Rich instruction');
      expect(richTextUpdate.data.editorData).toEqual(nextEditorData);
    });
  });

  describe('coexisting assignees (agent + member)', () => {
    // The executing agent and the human owner are independent sides that can
    // coexist on one task — the tool layer and the UI both rely on the router
    // never cross-clearing them.
    const setupWorkspace = async () => {
      const workspaceId = 'task-assignee-coexist-workspace';
      const { agents, workspaces, workspaceMembers } = await import('@/database/schemas');
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Assignee Coexist Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await serverDB.insert(workspaceMembers).values([
        { role: 'owner', userId, workspaceId },
        { role: 'member', userId: otherUserId!, workspaceId },
      ]);
      const wsAgentId = 'agt_assignee_coexist_ws';
      await serverDB
        .insert(agents)
        .values({ id: wsAgentId, slug: wsAgentId, userId, workspaceId })
        .onConflictDoNothing();
      return {
        workspaceId,
        wsAgentId,
        wsCaller: taskRouter.createCaller({ ...createTestContext(userId), workspaceId }),
      };
    };

    it('creates a task with an executing agent AND a human owner, notifying the member once', async () => {
      otherUserId = await createTestUser(serverDB);
      const { wsAgentId, wsCaller } = await setupWorkspace();

      const task = await wsCaller.create({
        assigneeAgentId: wsAgentId,
        assigneeUserId: otherUserId,
        instruction: 'Coexisting assignees',
      });

      expect(task.data.assigneeAgentId).toBe(wsAgentId);
      expect(task.data.assigneeUserId).toBe(otherUserId);
      await flushAfterResponse();
      expect(mockNotifyTaskAssigned).toHaveBeenCalledTimes(1);
      expect(mockNotifyTaskAssigned).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserId: otherUserId, taskId: task.data.id }),
      );
    });

    it('updating one assignee side never clears the other', async () => {
      otherUserId = await createTestUser(serverDB);
      const { wsAgentId, wsCaller } = await setupWorkspace();
      const task = await wsCaller.create({ assigneeAgentId: wsAgentId, instruction: 'Sides' });

      const withMember = await wsCaller.update({ assigneeUserId: otherUserId, id: task.data.id });
      expect(withMember.data.assigneeAgentId).toBe(wsAgentId);
      expect(withMember.data.assigneeUserId).toBe(otherUserId);

      const agentCleared = await wsCaller.update({ assigneeAgentId: null, id: task.data.id });
      expect(agentCleared.data.assigneeAgentId).toBeNull();
      expect(agentCleared.data.assigneeUserId).toBe(otherUserId);

      const memberCleared = await wsCaller.update({ assigneeUserId: null, id: task.data.id });
      expect(memberCleared.data.assigneeUserId).toBeNull();
      expect(memberCleared.data.assigneeAgentId).toBeNull();
    });
  });

  describe('subtasks + dependencies', () => {
    it('should create subtasks and set dependencies', async () => {
      const parent = await caller.create({
        instruction: 'Write a book',
        name: 'Book',
      });

      const ch1 = await caller.create({
        instruction: 'Write chapter 1',
        name: 'Chapter 1',
        parentTaskId: parent.data.id,
      });
      const ch2 = await caller.create({
        instruction: 'Write chapter 2',
        name: 'Chapter 2',
        parentTaskId: parent.data.id,
      });

      // Add dependency: ch2 blocks on ch1
      await caller.addDependency({
        dependsOnId: ch1.data.id,
        taskId: ch2.data.id,
      });

      const detail = await caller.detail({ id: parent.data.identifier });
      expect(detail.data.subtasks).toHaveLength(2);
      // ch2 should have blockedBy pointing to ch1's identifier
      const ch2Sub = detail.data.subtasks!.find((s) => s.name === 'Chapter 2');
      expect(ch2Sub?.blockedBy).toBeTruthy();
    });

    it('should reparent tasks and allow moving them back to top level', async () => {
      const parent = await caller.create({ instruction: 'Parent', name: 'Parent' });
      const newParent = await caller.create({ instruction: 'New parent', name: 'New Parent' });
      const child = await caller.create({
        instruction: 'Child',
        name: 'Child',
        parentTaskId: parent.data.id,
      });

      const reparented = await caller.update({
        id: child.data.identifier,
        parentTaskId: newParent.data.identifier,
      });

      expect(reparented.data.parentTaskId).toBe(newParent.data.id);

      const topLevel = await caller.update({
        id: child.data.identifier,
        parentTaskId: null,
      });

      expect(topLevel.data.parentTaskId).toBeNull();
    });

    it('should reject reparenting a public task under a private parent', async () => {
      const privateParent = await caller.create({
        instruction: 'Private parent',
        name: 'Private Parent',
        visibility: 'private',
      });
      const publicChild = await caller.create({
        instruction: 'Public child',
        name: 'Public Child',
        visibility: 'public',
      });

      await expect(
        caller.update({
          id: publicChild.data.identifier,
          parentTaskId: privateParent.data.identifier,
        }),
      ).rejects.toThrow('subtask cannot be more public than its parent');
    });

    it('should reject reparenting a task to itself or its descendant', async () => {
      const parent = await caller.create({ instruction: 'Parent', name: 'Parent' });
      const child = await caller.create({
        instruction: 'Child',
        name: 'Child',
        parentTaskId: parent.data.id,
      });

      await expect(
        caller.update({
          id: parent.data.identifier,
          parentTaskId: parent.data.identifier,
        }),
      ).rejects.toThrow('Task cannot be parented to itself');

      await expect(
        caller.update({
          id: parent.data.identifier,
          parentTaskId: child.data.identifier,
        }),
      ).rejects.toThrow('Task cannot be parented to its own descendant');
    });
  });

  describe('status transitions', () => {
    it('should transition backlog → running → paused → completed', async () => {
      const task = await caller.create({ instruction: 'Test' });

      // backlog → running
      const running = await caller.updateStatus({
        id: task.data.id,
        status: 'running',
      });
      expect(running.data.status).toBe('running');

      // running → paused
      const paused = await caller.updateStatus({
        id: task.data.id,
        status: 'paused',
      });
      expect(paused.data.status).toBe('paused');

      // paused → completed
      const completed = await caller.updateStatus({
        id: task.data.id,
        status: 'completed',
      });
      expect(completed.data.status).toBe('completed');
    });

    it('resolves a task identifier to its row when changing status', async () => {
      const task = await caller.create({ instruction: 'Test identifier resolution' });

      const running = await caller.updateStatus({
        id: task.data.identifier,
        status: 'running',
      });

      expect(running.data).toMatchObject({ id: task.data.id, status: 'running' });
    });
  });

  describe('comments', () => {
    it('should add and retrieve comments', async () => {
      const task = await caller.create({ instruction: 'Test' });

      await caller.addComment({
        content: 'First comment',
        id: task.data.id,
      });
      await caller.addComment({
        content: 'Second comment',
        id: task.data.id,
      });

      const detail = await caller.detail({ id: task.data.identifier });
      const commentActivities = detail.data.activities?.filter((a) => a.type === 'comment');
      expect(commentActivities).toHaveLength(2);
      expect(commentActivities?.[0].content).toBe('First comment');
    });

    it('should add agent-authored comments and support update/delete', async () => {
      const task = await caller.create({ instruction: 'Test' });

      const added = await caller.addComment({
        authorAgentId: testAgentId,
        content: 'Agent progress note',
        id: task.data.id,
      });

      expect(added.data.authorAgentId).toBe(testAgentId);
      expect(added.data.authorUserId).toBeNull();

      await caller.updateComment({
        commentId: added.data.id,
        content: 'Updated progress note',
      });

      const updatedDetail = await caller.detail({ id: task.data.identifier });
      const updatedComment = updatedDetail.data.activities?.find((a) => a.id === added.data.id);
      expect(updatedComment?.content).toBe('Updated progress note');
      expect(updatedComment?.agentId).toBe(testAgentId);

      await caller.deleteComment({ commentId: added.data.id });

      const deletedDetail = await caller.detail({ id: task.data.identifier });
      expect(deletedDetail.data.activities?.some((a) => a.id === added.data.id)).toBe(false);
    });

    it('should clear stale editorData for content-only comment updates', async () => {
      const task = await caller.create({ instruction: 'Test' });
      const comment = await caller.addComment({
        content: 'Old comment',
        editorData: { root: { children: [{ text: 'Old comment' }] } },
        id: task.data.id,
      });

      const contentOnlyUpdate = await caller.updateComment({
        commentId: comment.data.id,
        content: 'New comment',
      });

      expect(contentOnlyUpdate.data.content).toBe('New comment');
      expect(contentOnlyUpdate.data.editorData).toBeNull();

      const nextEditorData = { root: { children: [{ text: 'Rich comment' }] } };
      const richTextUpdate = await caller.updateComment({
        commentId: comment.data.id,
        content: 'Rich comment',
        editorData: nextEditorData,
      });

      expect(richTextUpdate.data.content).toBe('Rich comment');
      expect(richTextUpdate.data.editorData).toEqual(nextEditorData);
    });
  });

  describe('comment notifications', () => {
    const mentionNode = (userId: string) => ({
      label: 'Member',
      metadata: { id: userId, type: 'member' },
      type: 'mention',
    });
    const editorDataWith = (...userIds: string[]) => ({
      root: { children: [{ children: userIds.map(mentionNode), type: 'paragraph' }] },
    });

    const setupWorkspace = async () => {
      const workspaceId = 'task-comment-notify-workspace';
      const { workspaces, workspaceMembers } = await import('@/database/schemas');
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Task Comment Notify Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await serverDB.insert(workspaceMembers).values([
        { role: 'owner', userId, workspaceId },
        { role: 'member', userId: otherUserId!, workspaceId },
      ]);
      return {
        wsCaller: taskRouter.createCaller({ ...createTestContext(userId), workspaceId }),
        wsOtherCaller: taskRouter.createCaller({
          ...createTestContext(otherUserId!),
          workspaceId,
        }),
        workspaceId,
      };
    };

    it('should ping the task creator and @mentioned members on a new member comment', async () => {
      otherUserId = await createTestUser(serverDB);
      const { wsCaller, wsOtherCaller, workspaceId } = await setupWorkspace();
      const task = await wsCaller.create({ instruction: 'Discuss', name: 'Discuss' });

      // The creator commenting on their own task with no mentions pings nobody.
      await wsCaller.addComment({ content: 'note to self', id: task.data.id });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();

      // Another member commenting pings the creator as ambient activity.
      const comment = await wsOtherCaller.addComment({ content: 'hello', id: task.data.id });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).toHaveBeenCalledTimes(1);
      expect(mockNotifyTaskCommentActivity).toHaveBeenCalledWith({
        actorUserId: otherUserId,
        commentId: comment.data.id,
        recipients: [{ kind: 'commented', userId }],
        taskId: task.data.id,
        workspaceId,
      });

      // The creator @mentioning the other member pings them as mentioned;
      // unknown ids and self-mentions are dropped.
      const mentioned = await wsCaller.addComment({
        content: '@Member look',
        editorData: editorDataWith(otherUserId!, userId, 'not-a-member'),
        id: task.data.id,
      });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).toHaveBeenLastCalledWith({
        actorUserId: userId,
        commentId: mentioned.data.id,
        recipients: [{ kind: 'mentioned', userId: otherUserId }],
        taskId: task.data.id,
        workspaceId,
      });
    });

    it('should upgrade the assignee to mentioned and skip agent-authored comments', async () => {
      otherUserId = await createTestUser(serverDB);
      const { wsCaller, workspaceId } = await setupWorkspace();
      const task = await wsCaller.create({
        assigneeUserId: otherUserId,
        instruction: 'Assigned',
      });
      await flushAfterResponse();
      mockNotifyTaskCommentActivity.mockClear();

      await wsCaller.addComment({ content: 'ping', id: task.data.id });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({
          recipients: [{ kind: 'commented', userId: otherUserId }],
          workspaceId,
        }),
      );

      await wsCaller.addComment({
        content: '@Member',
        editorData: editorDataWith(otherUserId!),
        id: task.data.id,
      });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ recipients: [{ kind: 'mentioned', userId: otherUserId }] }),
      );

      // Agent-authored progress notes never ping members, even with mentions.
      const { agents } = await import('@/database/schemas');
      const wsAgentId = 'agt_task_comment_ws';
      await serverDB
        .insert(agents)
        .values({ id: wsAgentId, slug: wsAgentId, userId, workspaceId })
        .onConflictDoNothing();
      await flushAfterResponse();
      mockNotifyTaskCommentActivity.mockClear();
      await wsCaller.addComment({
        authorAgentId: wsAgentId,
        content: 'Agent progress note',
        editorData: editorDataWith(otherUserId!),
        id: task.data.id,
      });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();
    });

    it('should only ping newly added mentions when a comment is edited', async () => {
      otherUserId = await createTestUser(serverDB);
      const thirdUserId = await createTestUser(serverDB);
      const { wsCaller, workspaceId } = await setupWorkspace();
      const { workspaceMembers } = await import('@/database/schemas');
      await serverDB
        .insert(workspaceMembers)
        .values({ role: 'member', userId: thirdUserId, workspaceId });
      const task = await wsCaller.create({ instruction: 'Edit mentions' });
      const comment = await wsCaller.addComment({
        content: '@Member',
        editorData: editorDataWith(otherUserId!),
        id: task.data.id,
      });
      await flushAfterResponse();
      mockNotifyTaskCommentActivity.mockClear();

      // Keeping the same mention does not re-notify.
      await wsCaller.updateComment({
        commentId: comment.data.id,
        content: '@Member edited',
        editorData: editorDataWith(otherUserId!),
      });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();

      // Adding a new mention pings only the new member.
      await wsCaller.updateComment({
        commentId: comment.data.id,
        content: '@Member @Third',
        editorData: editorDataWith(otherUserId!, thirdUserId),
      });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).toHaveBeenCalledTimes(1);
      expect(mockNotifyTaskCommentActivity).toHaveBeenCalledWith({
        actorUserId: userId,
        commentId: comment.data.id,
        recipients: [{ kind: 'mentioned', userId: thirdUserId }],
        taskId: task.data.id,
        workspaceId,
      });

      // Content-only edits never notify.
      await wsCaller.updateComment({ commentId: comment.data.id, content: 'plain' });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).toHaveBeenCalledTimes(1);
    });

    it('should never notify members who cannot open a private task', async () => {
      otherUserId = await createTestUser(serverDB);
      const thirdUserId = await createTestUser(serverDB);
      const { wsCaller, workspaceId } = await setupWorkspace();
      const { workspaceMembers } = await import('@/database/schemas');
      await serverDB
        .insert(workspaceMembers)
        .values({ role: 'member', userId: thirdUserId, workspaceId });
      // A private task is visible to its creator only (assigning it to another
      // member is rejected upstream), yet the creator can still @mention anyone.
      const task = await wsCaller.create({
        instruction: 'Secret',
        name: 'Secret',
        visibility: 'private',
      });

      // The mention must not leak the task's title and link to a member who
      // cannot open it — neither on a new comment nor on an edit.
      const comment = await wsCaller.addComment({
        content: '@Member',
        editorData: editorDataWith(otherUserId!),
        id: task.data.id,
      });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();

      await wsCaller.updateComment({
        commentId: comment.data.id,
        content: '@Member @Third',
        editorData: editorDataWith(otherUserId!, thirdUserId),
      });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();
    });

    it('should never notify in personal mode', async () => {
      const task = await caller.create({ instruction: 'Personal' });
      await caller.addComment({
        content: '@someone',
        editorData: editorDataWith('someone'),
        id: task.data.id,
      });
      await flushAfterResponse();
      expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();
    });
  });

  describe('review config', () => {
    it('should set and retrieve review rubrics', async () => {
      const task = await caller.create({ instruction: 'Test' });

      await caller.updateReview({
        id: task.data.id,
        review: {
          autoRetry: true,
          enabled: true,
          maxIterations: 3,
          rubrics: [
            {
              config: { criteria: '内容准确性' },
              id: 'r1',
              name: '准确性',
              threshold: 0.8,
              type: 'llm-rubric',
              weight: 1,
            },
            {
              config: { value: '```' },
              id: 'r2',
              name: '包含代码',
              type: 'contains',
              weight: 1,
            },
          ],
        },
      });

      const review = await caller.getReview({ id: task.data.id });
      expect(review.data!.enabled).toBe(true);
      expect(review.data!.rubrics).toHaveLength(2);
      expect(review.data!.rubrics[0].type).toBe('llm-rubric');
    });
  });

  describe('verify config', () => {
    it('moves verify config supplied at task creation into Acceptance', async () => {
      const task = await caller.create({
        config: {
          model: 'test-model',
          verify: { enabled: true, maxIterations: 2, requirement: 'Ship the artifact' },
        },
        instruction: 'Test',
      });

      const storedTask = await new TaskModel(serverDB, userId).findById(task.data.id);
      const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject(
        'task',
        task.data.id,
      );

      expect(storedTask?.config).toEqual({ model: 'test-model' });
      expect(acceptance).toMatchObject({
        config: { enabled: true, maxIterations: 2 },
        requirement: 'Ship the artifact',
      });
    });

    it('should set and retrieve verify config (round-trip)', async () => {
      const task = await caller.create({ instruction: 'Test' });

      await caller.updateVerifyConfig({
        id: task.data.id,
        verify: {
          enabled: true,
          maxIterations: 3,
          verifierAgentId: 'agt_codex',
          verifyCriteriaIds: ['c1', 'c2'],
          verifyRubricId: 'rub_1',
        },
      });

      const verify = await caller.getVerifyConfig({ id: task.data.id });
      expect(verify.data).toEqual({
        enabled: true,
        maxIterations: 3,
        verifierAgentId: 'agt_codex',
        verifyCriteriaIds: ['c1', 'c2'],
        verifyRubricId: 'rub_1',
      });

      // task.detail must surface the saved verify config (not leave it undefined).
      const detail = await caller.detail({ id: task.data.id });
      expect(detail.data!.verify).toEqual({
        enabled: true,
        maxIterations: 3,
        verifierAgentId: 'agt_codex',
        verifyCriteriaIds: ['c1', 'c2'],
        verifyRubricId: 'rub_1',
      });

      const storedTask = await new TaskModel(serverDB, userId).findById(task.data.id);
      const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject(
        'task',
        task.data.id,
      );
      expect(storedTask?.config).not.toHaveProperty('verify');
      expect(acceptance).toMatchObject({
        config: {
          enabled: true,
          maxIterations: 3,
          verifierAgentId: 'agt_codex',
          verifyCriteriaIds: ['c1', 'c2'],
          verifyRubricId: 'rub_1',
        },
      });
    });

    it('should clear a saved field when passed null', async () => {
      const task = await caller.create({ instruction: 'Test' });

      await caller.updateVerifyConfig({
        id: task.data.id,
        verify: { enabled: true, verifierAgentId: 'agt_codex', verifyRubricId: 'rub_1' },
      });

      // Switch the verifier back to default + drop the rubric.
      await caller.updateVerifyConfig({
        id: task.data.id,
        verify: { verifierAgentId: null, verifyRubricId: null },
      });

      const verify = await caller.getVerifyConfig({ id: task.data.id });
      expect(verify.data).toEqual({ enabled: true });
    });

    it('getVerifyConfig falls back to the legacy review key', async () => {
      const task = await caller.create({ instruction: 'Test' });

      await caller.updateReview({
        id: task.data.id,
        review: { autoRetry: true, enabled: true, maxIterations: 4, rubrics: [] },
      });

      const verify = await caller.getVerifyConfig({ id: task.data.id });
      expect(verify.data).toEqual({ enabled: true, maxIterations: 4 });
    });

    it('preserves legacy verify fields when applying a partial Acceptance patch', async () => {
      const task = await caller.create({ instruction: 'Test' });
      await new TaskModel(serverDB, userId).updateVerifyConfig(task.data.id, {
        enabled: true,
        maxIterations: 4,
        verifierAgentId: 'legacy-verifier',
      });

      await caller.updateVerifyConfig({
        id: task.data.id,
        verify: { maxIterations: 2 },
      });

      const verify = await caller.getVerifyConfig({ id: task.data.id });
      expect(verify.data).toEqual({
        enabled: true,
        maxIterations: 2,
        verifierAgentId: 'legacy-verifier',
      });
    });
  });

  describe('run idempotency', () => {
    it('resolves a task identifier to its row when starting a run', async () => {
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Test',
      });

      await caller.run({ id: task.data.identifier });

      const updated = await caller.detail({ id: task.data.id });
      expect(updated.data?.status).toBe('running');
    });

    it('should reject run when a topic is already running', async () => {
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Test',
      });

      // First run succeeds
      await caller.run({ id: task.data.id });

      // Second run should fail with CONFLICT
      await expect(caller.run({ id: task.data.id })).rejects.toThrow(/already has a running topic/);
    });

    it('should reject continue on already running topic', async () => {
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Test',
      });

      await caller.run({ id: task.data.id });

      await expect(caller.run({ continueTopicId: 'tpc_test', id: task.data.id })).rejects.toThrow(
        /already running/,
      );
    });
  });

  describe('run error rollback', () => {
    it('should rollback task status to paused on run failure', async () => {
      mockExecAgent.mockRejectedValueOnce(new Error('LLM failed'));

      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Test',
      });

      await expect(caller.run({ id: task.data.id })).rejects.toThrow();

      // Task should be rolled back to paused with error
      const found = await caller.find({ id: task.data.id });
      expect(found.data.status).toBe('paused');
      expect(found.data.error).toContain('LLM failed');
    });
  });

  describe('clearAll', () => {
    it('should delete all tasks for user', async () => {
      await caller.create({ instruction: 'Task 1' });
      await caller.create({ instruction: 'Task 2' });
      await caller.create({ instruction: 'Task 3' });

      const result = await caller.clearAll();
      expect(result.count).toBe(3);

      const list = await caller.list({});
      expect(list.data).toHaveLength(0);
    });
  });

  describe('cancelTopic', () => {
    it('should cancel a running topic and pause task', async () => {
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Test',
      });

      await caller.run({ id: task.data.id });

      // Cancel the topic
      await caller.cancelTopic({ topicId: 'tpc_test' });

      // Task should be paused
      const found = await caller.find({ id: task.data.id });
      expect(found.data.status).toBe('paused');
    });

    it('should reject cancel on non-running topic', async () => {
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Test',
      });

      await caller.run({ id: task.data.id });
      await caller.cancelTopic({ topicId: 'tpc_test' });

      // Try to cancel again — should fail
      await expect(caller.cancelTopic({ topicId: 'tpc_test' })).rejects.toThrow(/not running/);
    });
  });

  describe('workspace documents', () => {
    it('should pin and show documents in detail', async () => {
      const task = await caller.create({ instruction: 'Test' });

      // Create a document via the documents table directly
      const { documents } = await import('@/database/schemas');
      const [doc] = await serverDB
        .insert(documents)
        .values({
          content: 'Test content',
          fileType: 'markdown',
          source: 'test',
          sourceType: 'api',
          title: 'Test Doc',
          totalCharCount: 12,
          totalLineCount: 1,
          userId,
        })
        .returning();

      // Pin to task
      await caller.pinDocument({
        documentId: doc.id,
        pinnedBy: 'user',
        taskId: task.data.id,
      });

      // Check detail workspace
      const detail = await caller.detail({ id: task.data.identifier });
      expect(detail.data.workspace).toBeDefined();
      // Document should appear somewhere in the workspace tree
      const allDocs = detail.data.workspace!.flatMap((f) => [
        { documentId: f.documentId, title: f.title },
        ...(f.children ?? []),
      ]);
      expect(allDocs.find((d) => d.documentId === doc.id)?.title).toBe('Test Doc');

      // Unpin
      await caller.unpinDocument({
        documentId: doc.id,
        taskId: task.data.id,
      });

      const detail2 = await caller.detail({ id: task.data.identifier });
      expect(detail2.data.workspace).toBeUndefined();
    });
  });

  describe('updateStatus cascade cancels running topics', () => {
    it('should cancel running topics when task transitions out of running', async () => {
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Test cascade',
      });

      // Start running — creates a running topic
      await caller.run({ id: task.data.id });

      // Transition task from running → paused via updateStatus
      const result = await caller.updateStatus({
        id: task.data.id,
        status: 'paused',
      });
      expect(result.data.status).toBe('paused');

      // The running topic should have been interrupted
      expect(mockInterruptTask).toHaveBeenCalledWith({ operationId: 'op_test' });

      // Running again should succeed (no CONFLICT) because the topic was canceled
      mockExecAgent.mockResolvedValueOnce({
        operationId: 'op_test_2',
        success: true,
        topicId: testTopicId,
      });

      // Need to set back to a runnable status first
      await caller.updateStatus({ id: task.data.id, status: 'backlog' });
      await expect(caller.run({ id: task.data.id })).resolves.toBeDefined();
    });

    it('should not interrupt topics when task is not currently running', async () => {
      const task = await caller.create({
        instruction: 'Test no cascade',
      });

      // Task is in backlog, transition to paused — no topics to cancel
      await caller.updateStatus({ id: task.data.id, status: 'paused' });
      expect(mockInterruptTask).not.toHaveBeenCalled();
    });

    it('should skip cancellation when interrupt fails', async () => {
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Test interrupt failure',
      });

      await caller.run({ id: task.data.id });

      // Make interruptTask fail
      mockInterruptTask.mockRejectedValueOnce(new Error('network error'));

      // Transition task from running → paused
      await caller.updateStatus({ id: task.data.id, status: 'paused' });

      // The topic should still be running because interrupt failed
      // so re-running should hit CONFLICT
      await caller.updateStatus({ id: task.data.id, status: 'backlog' });
      await expect(caller.run({ id: task.data.id })).rejects.toThrow(/already has a running topic/);
    });
  });

  describe('list participants', () => {
    it('should populate participants from assignee agent', async () => {
      const { agents } = await import('@/database/schemas');
      const { eq } = await import('drizzle-orm');
      await serverDB
        .update(agents)
        .set({ avatar: 'avatar.png', title: 'Agent One' })
        .where(eq(agents.id, testAgentId));

      await caller.create({ assigneeAgentId: testAgentId, instruction: 'Task A' });
      await caller.create({ instruction: 'Task without assignee' });

      const list = await caller.list({});
      expect(list.data).toHaveLength(2);

      const assigned = list.data.find((t) => t.assigneeAgentId === testAgentId)!;
      expect(assigned.participants).toEqual([
        {
          avatar: 'avatar.png',
          backgroundColor: null,
          id: testAgentId,
          title: 'Agent One',
          type: 'agent',
        },
      ]);

      const unassigned = list.data.find((t) => !t.assigneeAgentId)!;
      expect(unassigned.participants).toEqual([]);
    });
  });

  describe('heartbeat timeout detection', () => {
    it('should auto-detect timeout on detail and pause task', async () => {
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Test',
      });

      // Start running with very short timeout
      await caller.update({
        heartbeatTimeout: 1,
        id: task.data.id,
      });

      await caller.run({ id: task.data.id });

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 1500));

      // detail should auto-detect timeout and pause
      const detail = await caller.detail({ id: task.data.identifier });
      expect(detail.data.status).toBe('paused');
      // Verify stale timeout error gets cleared via find
      const found = await caller.find({ id: task.data.id });
      expect(found.data.error).toBeNull();
    });
  });

  describe('subtask layers + batch run', () => {
    it('previewSubtaskLayers groups subtasks by dependency level', async () => {
      const parent = await caller.create({ instruction: 'Book' });
      const ch1 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 1',
        parentTaskId: parent.data.id,
      });
      const ch2 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 2',
        parentTaskId: parent.data.id,
      });
      const ch3 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 3',
        parentTaskId: parent.data.id,
      });
      // ch3 depends on ch1 and ch2
      await caller.addDependency({ dependsOnId: ch1.data.id, taskId: ch3.data.id });
      await caller.addDependency({ dependsOnId: ch2.data.id, taskId: ch3.data.id });

      const result = await caller.previewSubtaskLayers({ id: parent.data.id });
      expect(result.data.layers).toHaveLength(2);
      expect(result.data.layers[0].sort()).toEqual([ch1.data.identifier, ch2.data.identifier]);
      expect(result.data.layers[1]).toEqual([ch3.data.identifier]);
      expect(result.data.totalRunnable).toBe(3);
      expect(result.data.cycles).toEqual([]);
    });

    it('previewSubtaskLayers reports cycles instead of layering them', async () => {
      const parent = await caller.create({ instruction: 'Cyclic' });
      const a = await caller.create({
        instruction: 'A',
        parentTaskId: parent.data.id,
      });
      const b = await caller.create({
        instruction: 'B',
        parentTaskId: parent.data.id,
      });
      await caller.addDependency({ dependsOnId: a.data.id, taskId: b.data.id });
      await caller.addDependency({ dependsOnId: b.data.id, taskId: a.data.id });

      const result = await caller.previewSubtaskLayers({ id: parent.data.id });
      expect(result.data.layers).toEqual([]);
      expect(result.data.cycles.sort()).toEqual([a.data.identifier, b.data.identifier]);
    });

    it('runReadySubtasks kicks off the first layer only', async () => {
      const parent = await caller.create({ instruction: 'Book' });
      const ch1 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 1',
        parentTaskId: parent.data.id,
      });
      const ch2 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 2',
        parentTaskId: parent.data.id,
      });
      const ch3 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 3',
        parentTaskId: parent.data.id,
      });
      await caller.addDependency({ dependsOnId: ch1.data.id, taskId: ch3.data.id });
      await caller.addDependency({ dependsOnId: ch2.data.id, taskId: ch3.data.id });

      const result = await caller.runReadySubtasks({ id: parent.data.id });
      expect(result.success).toBe(true);
      expect(result.data.kickedOff?.sort()).toEqual([ch1.data.identifier, ch2.data.identifier]);
      // ch3 stays in backlog because layer 2 only fires after layer 1 completes
      const ch3After = await caller.find({ id: ch3.data.id });
      expect(ch3After.data.status).toBe('backlog');
      // The kicked-off tasks should now be running
      const ch1After = await caller.find({ id: ch1.data.id });
      expect(ch1After.data.status).toBe('running');
    });

    it('runReadySubtasks returns noop when nothing is runnable', async () => {
      const parent = await caller.create({ instruction: 'Empty' });
      const result = await caller.runReadySubtasks({ id: parent.data.id });
      expect(result.success).toBe(true);
      expect(result.data.kickedOff).toEqual([]);
      expect(result.data.skipped).toEqual({ reason: 'nothing-runnable' });
    });

    it('previewSubtaskLayers holds back dependents of in-flight subtasks (does not free them)', async () => {
      const parent = await caller.create({ instruction: 'Inflight blocker' });
      const ch1 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 1',
        parentTaskId: parent.data.id,
      });
      const ch2 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 2',
        parentTaskId: parent.data.id,
      });
      await caller.addDependency({ dependsOnId: ch1.data.id, taskId: ch2.data.id });

      // Kick ch1 off — now in `running` state
      await caller.run({ id: ch1.data.id });

      const result = await caller.previewSubtaskLayers({ id: parent.data.id });
      // ch1 is in flight (ineligible). ch2 must NOT appear in layers — its
      // upstream is still running.
      expect(result.data.layers).toEqual([]);
      expect(result.data.ineligible).toEqual([ch1.data.identifier]);
      expect(result.data.blockedExternally).toEqual([ch2.data.identifier]);
    });

    it('runReadySubtasks does not start a subtask whose blocker is still running', async () => {
      const parent = await caller.create({ instruction: 'Inflight runReady' });
      const ch1 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 1',
        parentTaskId: parent.data.id,
      });
      const ch2 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 2',
        parentTaskId: parent.data.id,
      });
      await caller.addDependency({ dependsOnId: ch1.data.id, taskId: ch2.data.id });

      await caller.run({ id: ch1.data.id });
      mockExecAgent.mockClear();

      const result = await caller.runReadySubtasks({ id: parent.data.id });
      // No layers ⇒ runReadySubtasks falls through to the "nothing-runnable" branch.
      expect(result.data.kickedOff).toEqual([]);
      expect(mockExecAgent).not.toHaveBeenCalled();
      const ch2After = await caller.find({ id: ch2.data.id });
      expect(ch2After.data.status).toBe('backlog');
    });

    it('previewSubtaskLayers respects a cross-scope blocker (dep outside the subtree)', async () => {
      // External blocker lives outside `parent`'s descendant tree
      const externalBlocker = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'External blocker',
      });
      const parent = await caller.create({ instruction: 'Cross-scope' });
      const ch1 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 1',
        parentTaskId: parent.data.id,
      });
      // ch1 depends on a task that is NOT a descendant of parent
      await caller.addDependency({ dependsOnId: externalBlocker.data.id, taskId: ch1.data.id });

      // External is still backlog → blocks ch1
      const blocked = await caller.previewSubtaskLayers({ id: parent.data.id });
      expect(blocked.data.layers).toEqual([]);
      expect(blocked.data.blockedExternally).toEqual([ch1.data.identifier]);

      // Mark external completed → cascade fires → ch1 is auto-kicked off.
      // This proves the blocker classification *and* the existing cascade hook
      // co-operate end-to-end across the scope boundary.
      await caller.updateStatus({ id: externalBlocker.data.id, status: 'completed' });
      const ch1After = await caller.find({ id: ch1.data.id });
      expect(ch1After.data.status).toBe('running');
    });

    it('updateStatus(completed) triggers cascade kickoff for unlocked downstream', async () => {
      const parent = await caller.create({ instruction: 'Cascade' });
      const ch1 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 1',
        parentTaskId: parent.data.id,
      });
      const ch2 = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Chapter 2',
        parentTaskId: parent.data.id,
      });
      await caller.addDependency({ dependsOnId: ch1.data.id, taskId: ch2.data.id });

      // Kick off layer 1 (just ch1)
      await caller.run({ id: ch1.data.id });

      // Mark ch1 completed → ch2 should auto-run (status 'running' + topic created)
      const completed = await caller.updateStatus({ id: ch1.data.id, status: 'completed' });
      expect(completed.unlocked).toEqual([ch2.data.identifier]);

      const ch2After = await caller.find({ id: ch2.data.id });
      expect(ch2After.data.status).toBe('running');
      // Verify the runner was actually invoked, not just the status flipped
      expect(mockExecAgent).toHaveBeenCalled();
    });
  });

  describe('agent model snapshot', () => {
    const setAgentModel = async (model: string | null, provider: string | null) => {
      const { agents } = await import('@/database/schemas');
      const { eq } = await import('drizzle-orm');
      await serverDB.update(agents).set({ model, provider }).where(eq(agents.id, testAgentId));
    };

    it('snapshots the agent model into task.config at create time', async () => {
      await setAgentModel('claude-sonnet-4-6', 'anthropic');

      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Snapshot at create',
      });

      expect(task.data.config).toMatchObject({
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
      });
    });

    it('skips snapshot when the agent has no model configured', async () => {
      await setAgentModel(null, null);

      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'No snapshot when agent has none',
      });

      expect(task.data.config).toEqual({});
    });

    it('skips snapshot when the task has no assignee', async () => {
      await setAgentModel('claude-sonnet-4-6', 'anthropic');

      const task = await caller.create({ instruction: 'Unassigned task' });

      expect(task.data.config).toEqual({});
    });

    it('preserves the snapshotted model when the agent default changes later', async () => {
      await setAgentModel('claude-sonnet-4-6', 'anthropic');
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Snapshot then drift',
      });

      // User flips the agent to an expensive chat model.
      await setAgentModel('gpt-5.4-pro', 'openai');

      await caller.run({ id: task.data.id });

      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6', provider: 'anthropic' }),
      );
    });

    it('backfills the snapshot on first run for tasks without config.model', async () => {
      // Simulate a task that pre-dates this fix: no snapshot yet.
      await setAgentModel(null, null);
      const task = await caller.create({
        assigneeAgentId: testAgentId,
        instruction: 'Pre-fix task',
      });
      expect(task.data.config).toEqual({});

      // User later configures the agent model.
      await setAgentModel('claude-sonnet-4-6', 'anthropic');

      await caller.run({ id: task.data.id });

      const after = await caller.find({ id: task.data.id });
      expect(after.data.config).toMatchObject({
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
      });
      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6', provider: 'anthropic' }),
      );
    });
  });

  describe('list scope (my tasks)', () => {
    it('should narrow the list to tasks assigned to or created by the caller', async () => {
      otherUserId = await createTestUser(serverDB);
      const workspaceId = 'task-list-scope-workspace';
      const { workspaces, workspaceMembers } = await import('@/database/schemas');
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Task List Scope Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await serverDB.insert(workspaceMembers).values([
        { role: 'owner', userId, workspaceId },
        { role: 'member', userId: otherUserId!, workspaceId },
      ]);
      const wsCaller = taskRouter.createCaller({ ...createTestContext(userId), workspaceId });
      const wsOtherCaller = taskRouter.createCaller({
        ...createTestContext(otherUserId),
        workspaceId,
      });

      const mineForOther = await wsCaller.create({
        assigneeUserId: otherUserId,
        instruction: 'Mine for other',
        name: 'Mine for other',
      });
      const othersForMe = await wsOtherCaller.create({
        assigneeUserId: userId,
        instruction: 'Others for me',
        name: 'Others for me',
      });
      await wsOtherCaller.create({ instruction: 'Others unassigned', name: 'Others unassigned' });

      const assigned = await wsCaller.list({ scope: 'assigned' });
      expect(assigned.total).toBe(1);
      expect(assigned.data.map((t) => t.id)).toEqual([othersForMe.data.id]);

      const created = await wsCaller.list({ scope: 'created' });
      expect(created.total).toBe(1);
      expect(created.data.map((t) => t.id)).toEqual([mineForOther.data.id]);

      const all = await wsCaller.list({});
      expect(all.total).toBe(3);
    });
  });

  describe('human assignee (assigneeUserId)', () => {
    it('should persist agent and member assignments independently', async () => {
      const created = await caller.create({
        assigneeAgentId: testAgentId,
        assigneeUserId: userId,
        instruction: 'Dual-assigned task',
      });

      expect(created.data.assigneeAgentId).toBe(testAgentId);
      expect(created.data.assigneeUserId).toBe(userId);

      const memberCleared = await caller.update({
        assigneeUserId: null,
        id: created.data.id,
      });
      expect(memberCleared.data.assigneeAgentId).toBe(testAgentId);
      expect(memberCleared.data.assigneeUserId).toBeNull();

      const memberRestored = await caller.update({
        assigneeUserId: userId,
        id: created.data.id,
      });
      const agentCleared = await caller.update({
        assigneeAgentId: null,
        id: memberRestored.data.id,
      });
      expect(agentCleared.data.assigneeAgentId).toBeNull();
      expect(agentCleared.data.assigneeUserId).toBe(userId);
    });

    it('should notify the assignee only on an actual assignment to someone else', async () => {
      otherUserId = await createTestUser(serverDB);
      const workspaceId = 'task-assign-notify-workspace';
      const { workspaces, workspaceMembers } = await import('@/database/schemas');
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Task Assign Notify Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await serverDB.insert(workspaceMembers).values([
        { role: 'owner', userId, workspaceId },
        { role: 'member', userId: otherUserId!, workspaceId },
      ]);
      const wsCaller = taskRouter.createCaller({ ...createTestContext(userId), workspaceId });

      // Create without assignee, then assign another member → notifies once.
      const task = await wsCaller.create({ instruction: 'Notify target', name: 'Notify target' });
      await flushAfterResponse();
      expect(mockNotifyTaskAssigned).not.toHaveBeenCalled();

      await wsCaller.update({ assigneeUserId: otherUserId, id: task.data.id });
      await flushAfterResponse();
      expect(mockNotifyTaskAssigned).toHaveBeenCalledTimes(1);
      expect(mockNotifyTaskAssigned).toHaveBeenCalledWith({
        actorUserId: userId,
        assigneeUserId: otherUserId,
        taskId: task.data.id,
        taskIdentifier: task.data.identifier,
        taskName: 'Notify target',
        workspaceId,
      });

      // Re-saving the same assignee is a no-op → no second notification.
      await wsCaller.update({ assigneeUserId: otherUserId, id: task.data.id });
      await flushAfterResponse();
      expect(mockNotifyTaskAssigned).toHaveBeenCalledTimes(1);

      // Self-assignment never notifies.
      await wsCaller.update({ assigneeUserId: userId, id: task.data.id });
      await flushAfterResponse();
      expect(mockNotifyTaskAssigned).toHaveBeenCalledTimes(1);

      // Clearing the assignee never notifies.
      await wsCaller.update({ assigneeUserId: null, id: task.data.id });
      await flushAfterResponse();
      expect(mockNotifyTaskAssigned).toHaveBeenCalledTimes(1);

      // Creating a task already assigned to another member notifies too.
      const created = await wsCaller.create({
        assigneeUserId: otherUserId,
        instruction: 'Assigned at creation',
      });
      await flushAfterResponse();
      expect(mockNotifyTaskAssigned).toHaveBeenCalledTimes(2);
      expect(mockNotifyTaskAssigned).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actorUserId: userId,
          assigneeUserId: otherUserId,
          taskId: created.data.id,
          workspaceId,
        }),
      );
    });

    it('should allow assigning to self in personal mode', async () => {
      const created = await caller.create({
        assigneeUserId: userId,
        instruction: 'Self-assigned task',
      });
      expect(created.data.assigneeUserId).toBe(userId);

      const cleared = await caller.update({ assigneeUserId: null, id: created.data.id });
      expect(cleared.data.assigneeUserId).toBeNull();
    });

    it('should reject assigning to another user in personal mode', async () => {
      otherUserId = await createTestUser(serverDB);

      await expect(
        caller.create({ assigneeUserId: otherUserId, instruction: 'Cross-user assignment' }),
      ).rejects.toThrow('Assignee user not found');

      const task = await caller.create({ instruction: 'Reassign target' });
      await expect(
        caller.update({ assigneeUserId: otherUserId, id: task.data.id }),
      ).rejects.toThrow('Assignee user not found');
    });

    it('should validate workspace membership when assigning in workspace mode', async () => {
      otherUserId = await createTestUser(serverDB);
      const outsiderId = await createTestUser(serverDB);
      const removedId = await createTestUser(serverDB);
      const workspaceId = 'task-assignee-workspace';
      const { workspaces, workspaceMembers } = await import('@/database/schemas');
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Task Assignee Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await serverDB.insert(workspaceMembers).values([
        { role: 'owner', userId, workspaceId },
        { role: 'member', userId: otherUserId!, workspaceId },
        { deletedAt: new Date(), role: 'member', userId: removedId, workspaceId },
      ]);
      const wsCaller = taskRouter.createCaller({ ...createTestContext(userId), workspaceId });

      const assigned = await wsCaller.create({
        assigneeUserId: otherUserId,
        instruction: 'Assigned to a member',
      });
      expect(assigned.data.assigneeUserId).toBe(otherUserId);

      await expect(
        wsCaller.create({ assigneeUserId: outsiderId, instruction: 'Assigned to an outsider' }),
      ).rejects.toThrow('Assignee user is not a member of this workspace');

      await expect(
        wsCaller.update({ assigneeUserId: removedId, id: assigned.data.id }),
      ).rejects.toThrow('Assignee user is not a member of this workspace');

      try {
        await cleanupTestUser(serverDB, outsiderId);
        await cleanupTestUser(serverDB, removedId);
      } catch {
        /* cascade cleanup is best-effort */
      }
    });

    it('should serialize assignments against concurrent membership removal', async () => {
      otherUserId = await createTestUser(serverDB);
      const memberId = otherUserId;
      const workspaceId = 'task-assignee-removal-race-workspace';
      const { tasks, workspaces, workspaceMembers } = await import('@/database/schemas');
      const { and, eq } = await import('drizzle-orm');
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Task Assignee Removal Race Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await serverDB.insert(workspaceMembers).values([
        { role: 'owner', userId, workspaceId },
        { role: 'member', userId: memberId, workspaceId },
      ]);
      const wsCaller = taskRouter.createCaller({ ...createTestContext(userId), workspaceId });
      const existingTask = await wsCaller.create({ instruction: 'Concurrent update target' });

      let signalMemberLocked: () => void = () => {};
      const memberLocked = new Promise<void>((resolve) => {
        signalMemberLocked = resolve;
      });
      let releaseRemoval: () => void = () => {};
      const removalReleased = new Promise<void>((resolve) => {
        releaseRemoval = resolve;
      });

      const removal = serverDB.transaction(async (tx) => {
        await tx
          .update(workspaceMembers)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, memberId),
            ),
          );
        signalMemberLocked();
        await removalReleased;
      });
      await memberLocked;

      let updateSettled = false;
      const update = wsCaller
        .update({ assigneeUserId: memberId, id: existingTask.data.id })
        .then(
          (value) => ({ error: null, value }),
          (error: Error) => ({ error, value: null }),
        )
        .finally(() => {
          updateSettled = true;
        });
      let createSettled = false;
      const create = wsCaller
        .create({ assigneeUserId: memberId, instruction: 'Concurrent create target' })
        .then(
          (value) => ({ error: null, value }),
          (error: Error) => ({ error, value: null }),
        )
        .finally(() => {
          createSettled = true;
        });

      // Both writes have started while removal owns the membership row. They
      // must wait for that row lock instead of committing from a stale read.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const updateWaitedForRemoval = !updateSettled;
      const createWaitedForRemoval = !createSettled;

      releaseRemoval();
      await removal;
      const [updateResult, createResult] = await Promise.all([update, create]);
      expect(updateWaitedForRemoval).toBe(true);
      expect(createWaitedForRemoval).toBe(true);
      expect(updateResult.error?.message).toContain(
        'Assignee user is not a member of this workspace',
      );
      expect(createResult.error?.message).toContain(
        'Assignee user is not a member of this workspace',
      );

      const [afterUpdate] = await serverDB
        .select({ assigneeUserId: tasks.assigneeUserId })
        .from(tasks)
        .where(eq(tasks.id, existingTask.data.id));
      expect(afterUpdate.assigneeUserId).toBeNull();
      const strandedCreate = await serverDB
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.instruction, 'Concurrent create target'));
      expect(strandedCreate).toHaveLength(0);
    });

    it('should keep private tasks creator-only for human assignees', async () => {
      otherUserId = await createTestUser(serverDB);
      const workspaceId = 'task-private-assignee-workspace';
      const { workspaces, workspaceMembers } = await import('@/database/schemas');
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Task Private Assignee Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await serverDB.insert(workspaceMembers).values([
        { role: 'owner', userId, workspaceId },
        { role: 'member', userId: otherUserId!, workspaceId },
      ]);
      const wsCaller = taskRouter.createCaller({ ...createTestContext(userId), workspaceId });

      // Creating a private task assigned to another member is rejected.
      await expect(
        wsCaller.create({
          assigneeUserId: otherUserId,
          instruction: 'Private cross-member create',
          visibility: 'private',
        }),
      ).rejects.toThrow('A private task can only be assigned to its creator');

      // A private task can still be self-assigned; assigning another member is rejected.
      const privateTask = await wsCaller.create({
        assigneeUserId: userId,
        instruction: 'Private task',
        visibility: 'private',
      });
      expect(privateTask.data.assigneeUserId).toBe(userId);
      await expect(
        wsCaller.update({ assigneeUserId: otherUserId, id: privateTask.data.id }),
      ).rejects.toThrow('A private task can only be assigned to its creator');

      // Demoting a member-assigned public task to private is rejected until unassigned.
      const publicTask = await wsCaller.create({
        assigneeUserId: otherUserId,
        instruction: 'Public task assigned to member',
        visibility: 'public',
      });
      await expect(
        wsCaller.updateVisibility({ id: publicTask.data.id, visibility: 'private' }),
      ).rejects.toThrow('A private task can only be assigned to its creator');
      await wsCaller.update({ assigneeUserId: null, id: publicTask.data.id });
      const demoted = await wsCaller.updateVisibility({
        id: publicTask.data.id,
        visibility: 'private',
      });
      expect(demoted.data.visibility).toBe('private');
    });

    it('should preserve the responsible assignee independently of automation', async () => {
      const createdScheduled = await caller.create({
        assigneeUserId: userId,
        automationMode: 'schedule',
        instruction: 'Automated assigned task',
        schedulePattern: '0 9 * * *',
      });
      expect(createdScheduled.data.assigneeUserId).toBe(userId);
      expect(createdScheduled.data.automationMode).toBe('schedule');

      const automated = await caller.create({
        automationMode: 'schedule',
        instruction: 'Automated task',
        schedulePattern: '0 9 * * *',
      });
      const assignedAutomated = await caller.update({
        assigneeUserId: userId,
        id: automated.data.id,
      });
      expect(assignedAutomated.data.assigneeUserId).toBe(userId);
      expect(assignedAutomated.data.automationMode).toBe('schedule');

      const humanTask = await caller.create({
        assigneeUserId: userId,
        instruction: 'Human task',
      });
      const scheduled = await caller.update({
        automationMode: 'schedule',
        id: humanTask.data.id,
        schedulePattern: '0 9 * * *',
      });
      expect(scheduled.data.automationMode).toBe('schedule');
      expect(scheduled.data.assigneeUserId).toBe(userId);
    });

    it('should keep inbox fallback ephemeral without clearing an explicit inbox assignment', async () => {
      // Seed the builtin inbox agent so the runner's fallback path can resolve it.
      const inboxAgentId = await createTestAgent(serverDB, userId, 'inbox');

      const humanTask = await caller.create({
        assigneeUserId: userId,
        instruction: 'Human-assigned task',
      });
      await caller.run({ id: humanTask.data.id });

      const afterHumanRun = await caller.find({ id: humanTask.data.id });
      expect(afterHumanRun.data.assigneeUserId).toBe(userId);
      expect(afterHumanRun.data.assigneeAgentId).toBeNull();

      // Inbox is also a valid explicit agent assignment. Once a member and an
      // agent can be selected independently, the persisted pair must survive
      // execution because it is indistinguishable from any historical fallback.
      const dualAssignedTask = await caller.create({
        assigneeUserId: userId,
        instruction: 'Inbox-and-member-assigned task',
      });
      await caller.update({ assigneeAgentId: inboxAgentId, id: dualAssignedTask.data.id });
      await caller.run({ id: dualAssignedTask.data.id });

      const afterDualAssignedRun = await caller.find({ id: dualAssignedTask.data.id });
      expect(afterDualAssignedRun.data.assigneeUserId).toBe(userId);
      expect(afterDualAssignedRun.data.assigneeAgentId).toBe(inboxAgentId);

      // Control: a fully unassigned task still gets the fallback persisted.
      const unassignedTask = await caller.create({ instruction: 'Unassigned task' });
      await caller.run({ id: unassignedTask.data.id });

      const afterUnassignedRun = await caller.find({ id: unassignedTask.data.id });
      expect(afterUnassignedRun.data.assigneeAgentId).toBe(inboxAgentId);
    });

    it('should populate a user participant in list', async () => {
      const { users } = await import('@/database/schemas');
      const { eq } = await import('drizzle-orm');
      await serverDB
        .update(users)
        .set({ avatar: 'user-avatar.png', fullName: 'User One' })
        .where(eq(users.id, userId));

      await caller.create({ assigneeUserId: userId, instruction: 'Human task' });

      const list = await caller.list({});
      const assigned = list.data.find((t) => t.assigneeUserId === userId)!;
      expect(assigned.participants).toEqual([
        {
          avatar: 'user-avatar.png',
          backgroundColor: null,
          id: userId,
          title: 'User One',
          type: 'user',
        },
      ]);
    });
  });
});
