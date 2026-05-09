// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  describe('run idempotency', () => {
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

      const result = await caller.run({ id: task.data.id });

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
});
