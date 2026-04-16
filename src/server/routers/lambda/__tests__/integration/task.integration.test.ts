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
      expect(detail.data.activities).toBeUndefined();
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
});
