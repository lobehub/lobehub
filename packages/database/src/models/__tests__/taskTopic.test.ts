// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskTopicModel } from '../taskTopic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-topic-test-user-id';
const userId2 = 'task-topic-test-user-id-2';

const createTopic = async (id: string, uid = userId) => {
  await serverDB.insert(topics).values({ id, userId: uid }).onConflictDoNothing();
  return id;
};

const getTopic = async (id: string) =>
  (await serverDB.select().from(topics).where(eq(topics.id, id)).limit(1))[0];

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskTopicModel', () => {
  describe('add and findByTaskId', () => {
    it('should add topic and get topics', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_aaa');
      await createTopic('tpc_bbb');

      await topicModel.add(task.id, 'tpc_aaa', { operationId: 'op_1', seq: 1 });
      await topicModel.add(task.id, 'tpc_bbb', { operationId: 'op_2', seq: 2 });

      const topics = await topicModel.findByTaskId(task.id);
      expect(topics).toHaveLength(2);
      expect(topics[0].seq).toBe(2); // ordered by seq desc
      expect(topics[1].seq).toBe(1);
      expect(topics[0].operationId).toBe('op_2');
      expect(topics[0].userId).toBe(userId);
    });

    it('should not duplicate topic (onConflictDoNothing)', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_aaa');

      await topicModel.add(task.id, 'tpc_aaa', { seq: 1 });
      await topicModel.add(task.id, 'tpc_aaa', { seq: 1 }); // duplicate

      const topics = await topicModel.findByTaskId(task.id);
      expect(topics).toHaveLength(1);
    });
  });

  describe('updateStatus', () => {
    it('should update topic status', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_aaa');

      await topicModel.add(task.id, 'tpc_aaa', { seq: 1 });
      await topicModel.updateStatus(task.id, 'tpc_aaa', 'completed');

      const topics = await topicModel.findByTaskId(task.id);
      expect(topics[0].status).toBe('completed');
    });

    it('should mirror completed status to topics row', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_done');

      await topicModel.add(task.id, 'tpc_done', { seq: 1 });
      await topicModel.updateStatus(task.id, 'tpc_done', 'completed');

      const topic = await getTopic('tpc_done');
      expect(topic.status).toBe('completed');
      expect(topic.completedAt).toBeInstanceOf(Date);
    });

    it('should stamp completedAt without promoting status for non-completed terminal states', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_failed');

      await topicModel.add(task.id, 'tpc_failed', { seq: 1 });
      await topicModel.updateStatus(task.id, 'tpc_failed', 'failed');

      const topic = await getTopic('tpc_failed');
      expect(topic.completedAt).toBeInstanceOf(Date);
      // topic.status stays whatever it was (default null), not promoted to 'completed'
      expect(topic.status).not.toBe('completed');
    });

    it('should not stamp completedAt for non-terminal status', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_running');

      await topicModel.add(task.id, 'tpc_running', { seq: 1 });
      await topicModel.updateStatus(task.id, 'tpc_running', 'running');

      const topic = await getTopic('tpc_running');
      expect(topic.completedAt).toBeNull();
    });
  });

  describe('cancelIfRunning', () => {
    it('should cancel + stamp completedAt when topic was running', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_cancel');

      await topicModel.add(task.id, 'tpc_cancel', { seq: 1 });
      const updated = await topicModel.cancelIfRunning(task.id, 'tpc_cancel');

      expect(updated).toBe(true);
      const topic = await getTopic('tpc_cancel');
      expect(topic.completedAt).toBeInstanceOf(Date);
      expect(topic.status).not.toBe('completed');
    });

    it('should be a no-op when topic is not running', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_already_done');

      await topicModel.add(task.id, 'tpc_already_done', { seq: 1 });
      await topicModel.updateStatus(task.id, 'tpc_already_done', 'completed');
      const completedAtBefore = (await getTopic('tpc_already_done')).completedAt;

      // sleep one tick so a re-stamp would be detectable
      await new Promise((r) => setTimeout(r, 5));
      const updated = await topicModel.cancelIfRunning(task.id, 'tpc_already_done');

      expect(updated).toBe(false);
      const topic = await getTopic('tpc_already_done');
      expect(topic.completedAt?.getTime()).toBe(completedAtBefore?.getTime());
    });
  });

  describe('timeoutRunning', () => {
    it('should timeout running topics only', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_aaa');
      await createTopic('tpc_bbb');

      await topicModel.add(task.id, 'tpc_aaa', { seq: 1 });
      await topicModel.add(task.id, 'tpc_bbb', { seq: 2 });
      await topicModel.updateStatus(task.id, 'tpc_aaa', 'completed');

      const count = await topicModel.timeoutRunning(task.id);
      expect(count).toBe(1);

      const topics = await topicModel.findByTaskId(task.id);
      const tpcA = topics.find((t) => t.topicId === 'tpc_aaa');
      const tpcB = topics.find((t) => t.topicId === 'tpc_bbb');
      expect(tpcA!.status).toBe('completed');
      expect(tpcB!.status).toBe('timeout');
    });

    it('should stamp completedAt on each timed-out topic', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_t1');
      await createTopic('tpc_t2');

      await topicModel.add(task.id, 'tpc_t1', { seq: 1 });
      await topicModel.add(task.id, 'tpc_t2', { seq: 2 });

      await topicModel.timeoutRunning(task.id);

      const t1 = await getTopic('tpc_t1');
      const t2 = await getTopic('tpc_t2');
      expect(t1.completedAt).toBeInstanceOf(Date);
      expect(t2.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('findWithHandoff', () => {
    it('should return completedAt joined from topics', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_h1');
      await createTopic('tpc_h2');

      await topicModel.add(task.id, 'tpc_h1', { seq: 1 });
      await topicModel.add(task.id, 'tpc_h2', { seq: 2 });
      await topicModel.updateStatus(task.id, 'tpc_h1', 'completed');

      const rows = await topicModel.findWithHandoff(task.id, 10);
      const h1 = rows.find((r) => r.topicId === 'tpc_h1');
      const h2 = rows.find((r) => r.topicId === 'tpc_h2');
      expect(h1?.completedAt).toBeInstanceOf(Date);
      expect(h2?.completedAt).toBeNull();
    });
  });

  describe('updateHandoff', () => {
    it('should store handoff data', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_aaa');

      await topicModel.add(task.id, 'tpc_aaa', { seq: 1 });
      await topicModel.updateHandoff(task.id, 'tpc_aaa', {
        keyFindings: ['Finding 1', 'Finding 2'],
        nextAction: 'Continue writing',
        summary: 'Completed chapter 1',
        title: '第1章完成',
      });

      const topics = await topicModel.findByTaskId(task.id);
      const handoff = topics[0].handoff as any;
      expect(handoff.title).toBe('第1章完成');
      expect(handoff.summary).toBe('Completed chapter 1');
      expect(handoff.nextAction).toBe('Continue writing');
      expect(handoff.keyFindings).toEqual(['Finding 1', 'Finding 2']);
    });
  });

  describe('updateReview', () => {
    it('should store review results', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_review');

      await topicModel.add(task.id, 'tpc_review', { seq: 1 });
      await topicModel.updateReview(task.id, 'tpc_review', {
        iteration: 1,
        passed: true,
        score: 85,
        scores: [
          { passed: true, reason: 'Good accuracy', rubricId: 'r1', score: 0.88 },
          { passed: true, reason: 'Code found', rubricId: 'r2', score: 1 },
        ],
      });

      const topics = await topicModel.findByTaskId(task.id);
      expect(topics[0].reviewPassed).toBe(1);
      expect(topics[0].reviewScore).toBe(85);
      expect(topics[0].reviewIteration).toBe(1);
      expect(topics[0].reviewedAt).toBeDefined();

      const scores = topics[0].reviewScores as any[];
      expect(scores).toHaveLength(2);
      expect(scores[0].rubricId).toBe('r1');
      expect(scores[1].score).toBe(1);
    });
  });

  describe('remove', () => {
    it('should remove topic association', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_aaa');

      await topicModel.add(task.id, 'tpc_aaa', { seq: 1 });
      const removed = await topicModel.remove(task.id, 'tpc_aaa');
      expect(removed).toBe(true);

      const topics = await topicModel.findByTaskId(task.id);
      expect(topics).toHaveLength(0);
    });

    it('should not remove topics of other users', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel1 = new TaskTopicModel(serverDB, userId);
      const topicModel2 = new TaskTopicModel(serverDB, userId2);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_aaa');

      await topicModel1.add(task.id, 'tpc_aaa', { seq: 1 });
      const removed = await topicModel2.remove(task.id, 'tpc_aaa');
      expect(removed).toBe(false);
    });
  });
});
