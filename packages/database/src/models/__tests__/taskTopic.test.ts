// @vitest-environment node
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
