// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, tasks, taskTopics, topics, users } from '../../schemas';
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

    it('should find running topics for multiple tasks within the current owner scope', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const otherTaskModel = new TaskModel(serverDB, userId2);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const otherTopicModel = new TaskTopicModel(serverDB, userId2);
      const task1 = await taskModel.create({ instruction: 'A' });
      const task2 = await taskModel.create({ instruction: 'B' });
      const otherTask = await otherTaskModel.create({ instruction: 'Other' });
      await createTopic('tpc_a1');
      await createTopic('tpc_a3');
      await createTopic('tpc_b2');
      await createTopic('tpc_theirs', userId2);

      await topicModel.add(task1.id, 'tpc_a1', { seq: 1 });
      await topicModel.add(task1.id, 'tpc_a3', { seq: 3 });
      await topicModel.add(task2.id, 'tpc_b2', { seq: 2 });
      await otherTopicModel.add(otherTask.id, 'tpc_theirs', { seq: 99 });
      await topicModel.updateStatus(task1.id, 'tpc_a1', 'completed');

      const rows = await topicModel.findRunningByTaskIds([task1.id, task2.id, otherTask.id]);
      expect(rows.map((row) => row.topicId)).toEqual(['tpc_a3', 'tpc_b2']);
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

  describe('countByTask', () => {
    it('counts every topic for the task when no options are passed', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_c1');
      await createTopic('tpc_c2');

      await topicModel.add(task.id, 'tpc_c1', { seq: 1 });
      await topicModel.add(task.id, 'tpc_c2', { seq: 2 });

      expect(await topicModel.countByTask(task.id)).toBe(2);
    });

    it('only counts topics created on/after `since` when provided', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_old');
      await createTopic('tpc_new');

      // Age the first topic 10 minutes into the past so the `since` window
      // (5 minutes ago) excludes it but includes the just-inserted second one.
      await topicModel.add(task.id, 'tpc_old', { seq: 1 });
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      await serverDB
        .update(taskTopics)
        .set({ createdAt: tenMinutesAgo })
        .where(eq(taskTopics.topicId, 'tpc_old'));

      await topicModel.add(task.id, 'tpc_new', { seq: 2 });

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      expect(await topicModel.countByTask(task.id, { since: fiveMinutesAgo })).toBe(1);
      expect(await topicModel.countByTask(task.id)).toBe(2);
    });

    it('does not bleed across tasks', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task1 = await taskModel.create({ instruction: 'A' });
      const task2 = await taskModel.create({ instruction: 'B' });
      await createTopic('tpc_a1');
      await createTopic('tpc_b1');

      await topicModel.add(task1.id, 'tpc_a1', { seq: 1 });
      await topicModel.add(task2.id, 'tpc_b1', { seq: 1 });

      expect(await topicModel.countByTask(task1.id)).toBe(1);
      expect(await topicModel.countByTask(task2.id)).toBe(1);
    });

    it('does not count topics owned by a different user', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const otherTopicModel = new TaskTopicModel(serverDB, userId2);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_mine');
      await createTopic('tpc_theirs', userId2);

      await topicModel.add(task.id, 'tpc_mine', { seq: 1 });
      // Directly insert a row attributed to userId2 on the same task to prove
      // the scope is `userId`, not just `taskId`.
      await serverDB.insert(taskTopics).values({
        seq: 2,
        taskId: task.id,
        topicId: 'tpc_theirs',
        userId: userId2,
      });

      expect(await topicModel.countByTask(task.id)).toBe(1);
      expect(await otherTopicModel.countByTask(task.id)).toBe(1);
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

    it('should return source task metadata when querying multiple task ids', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      await serverDB
        .insert(agents)
        .values({ id: 'agt_child', slug: 'agt_child', userId })
        .onConflictDoNothing();
      const parent = await taskModel.create({ instruction: 'Parent' });
      const child = await taskModel.create({
        assigneeAgentId: 'agt_child',
        instruction: 'Child',
        name: 'Child Task',
        parentTaskId: parent.id,
      });
      const sibling = await taskModel.create({ instruction: 'Sibling', parentTaskId: parent.id });
      await createTopic('tpc_child');
      await createTopic('tpc_sibling');

      await topicModel.add(child.id, 'tpc_child', { operationId: 'op_child', seq: 1 });
      await topicModel.add(sibling.id, 'tpc_sibling', { operationId: 'op_sibling', seq: 1 });

      const rows = await topicModel.findWithHandoffByTaskIds([child.id], 10);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        operationId: 'op_child',
        sourceTaskAssigneeAgentId: 'agt_child',
        sourceTaskId: child.id,
        sourceTaskIdentifier: child.identifier,
        sourceTaskName: 'Child Task',
        topicId: 'tpc_child',
      });
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

  describe('updateBriefDecision', () => {
    it('patches briefDecision into a fresh handoff JSONB (no prior handoff)', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_bd_a');

      await topicModel.add(task.id, 'tpc_bd_a', { seq: 1 });
      await topicModel.updateBriefDecision(task.id, 'tpc_bd_a', {
        decidedAt: '2026-05-01T12:00:00.000Z',
        emit: false,
        reason: 'heartbeat-tick',
        source: 'rule',
      });

      const topics = await topicModel.findByTaskId(task.id);
      const handoff = topics[0].handoff as any;
      expect(handoff.briefDecision).toEqual({
        decidedAt: '2026-05-01T12:00:00.000Z',
        emit: false,
        reason: 'heartbeat-tick',
        source: 'rule',
      });
    });

    it('preserves existing handoff fields when patching briefDecision', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_bd_b');

      await topicModel.add(task.id, 'tpc_bd_b', { seq: 1 });
      await topicModel.updateHandoff(task.id, 'tpc_bd_b', {
        keyFindings: ['F1'],
        nextAction: 'Next',
        summary: 'Sum',
        title: 'T',
      });
      await topicModel.updateBriefDecision(task.id, 'tpc_bd_b', {
        decidedAt: '2026-05-01T12:00:00.000Z',
        emit: true,
        model: 'opus-4',
        reason: 'finished deliverable',
        source: 'llm-judge',
      });

      const topics = await topicModel.findByTaskId(task.id);
      const handoff = topics[0].handoff as any;
      expect(handoff.title).toBe('T');
      expect(handoff.summary).toBe('Sum');
      expect(handoff.nextAction).toBe('Next');
      expect(handoff.keyFindings).toEqual(['F1']);
      expect(handoff.briefDecision.emit).toBe(true);
      expect(handoff.briefDecision.source).toBe('llm-judge');
      expect(handoff.briefDecision.model).toBe('opus-4');
    });

    it('overwrites a previous briefDecision on re-emit (e.g. retry)', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_bd_c');

      await topicModel.add(task.id, 'tpc_bd_c', { seq: 1 });
      await topicModel.updateBriefDecision(task.id, 'tpc_bd_c', {
        decidedAt: '2026-05-01T11:00:00.000Z',
        emit: false,
        reason: 'first call',
        source: 'rule',
      });
      await topicModel.updateBriefDecision(task.id, 'tpc_bd_c', {
        decidedAt: '2026-05-01T12:00:00.000Z',
        emit: true,
        reason: 'second call',
        source: 'llm-judge',
      });

      const topics = await topicModel.findByTaskId(task.id);
      const handoff = topics[0].handoff as any;
      expect(handoff.briefDecision.emit).toBe(true);
      expect(handoff.briefDecision.reason).toBe('second call');
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

  describe('findByTopicId', () => {
    it('returns the taskTopic row matching the topicId', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_find');

      await topicModel.add(task.id, 'tpc_find', { operationId: 'op_find', seq: 7 });

      const row = await topicModel.findByTopicId('tpc_find');
      expect(row).not.toBeNull();
      expect(row!.taskId).toBe(task.id);
      expect(row!.topicId).toBe('tpc_find');
      expect(row!.seq).toBe(7);
      expect(row!.operationId).toBe('op_find');
    });

    it('returns null when no row matches', async () => {
      const topicModel = new TaskTopicModel(serverDB, userId);
      const row = await topicModel.findByTopicId('tpc_missing');
      expect(row).toBeNull();
    });

    it('does not return a row owned by a different user', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const otherTopicModel = new TaskTopicModel(serverDB, userId2);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_owned');

      await topicModel.add(task.id, 'tpc_owned', { seq: 1 });

      expect(await topicModel.findByTopicId('tpc_owned')).not.toBeNull();
      expect(await otherTopicModel.findByTopicId('tpc_owned')).toBeNull();
    });
  });

  describe('updateOperationId', () => {
    it('updates the operationId for the task/topic pair', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_op');

      await topicModel.add(task.id, 'tpc_op', { operationId: 'op_old', seq: 1 });
      await topicModel.updateOperationId(task.id, 'tpc_op', 'op_new');

      const row = await topicModel.findByTopicId('tpc_op');
      expect(row!.operationId).toBe('op_new');
    });
  });

  describe('findWithDetails', () => {
    it('joins topic fields and orders by seq desc', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });

      await serverDB
        .insert(topics)
        .values([
          { id: 'tpc_d1', title: 'First', userId },
          { id: 'tpc_d2', title: 'Second', userId },
        ])
        .onConflictDoNothing();

      await topicModel.add(task.id, 'tpc_d1', { operationId: 'op_d1', seq: 1 });
      await topicModel.add(task.id, 'tpc_d2', { operationId: 'op_d2', seq: 2 });
      await topicModel.updateStatus(task.id, 'tpc_d1', 'completed');
      await topicModel.updateReview(task.id, 'tpc_d1', {
        iteration: 2,
        passed: true,
        score: 90,
        scores: [{ rubricId: 'r1', score: 1 }],
      });

      const rows = await topicModel.findWithDetails(task.id);
      expect(rows).toHaveLength(2);
      // seq desc ordering
      expect(rows[0].seq).toBe(2);
      expect(rows[1].seq).toBe(1);

      const d1 = rows.find((r) => r.id === 'tpc_d1')!;
      expect(d1.title).toBe('First');
      expect(d1.operationId).toBe('op_d1');
      expect(d1.status).toBe('completed');
      expect(d1.reviewIteration).toBe(2);
      expect(d1.reviewPassed).toBe(1);
      expect(d1.reviewScore).toBe(90);
      expect(d1.createdAt).toBeInstanceOf(Date);

      const d2 = rows.find((r) => r.id === 'tpc_d2')!;
      expect(d2.title).toBe('Second');
    });

    it('returns an empty array when the task has no topics', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });

      const rows = await topicModel.findWithDetails(task.id);
      expect(rows).toEqual([]);
    });

    it('does not return rows owned by a different user', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const otherTopicModel = new TaskTopicModel(serverDB, userId2);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_dx');

      await topicModel.add(task.id, 'tpc_dx', { seq: 1 });

      expect(await topicModel.findWithDetails(task.id)).toHaveLength(1);
      expect(await otherTopicModel.findWithDetails(task.id)).toHaveLength(0);
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

    it('decrements tasks.totalTopics (floored at 0) on successful remove', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await createTopic('tpc_r1');
      await createTopic('tpc_r2');

      await topicModel.add(task.id, 'tpc_r1', { seq: 1 });
      await topicModel.add(task.id, 'tpc_r2', { seq: 2 });
      // simulate the task counter having been incremented for the two topics
      await serverDB.update(tasks).set({ totalTopics: 2 }).where(eq(tasks.id, task.id));

      await topicModel.remove(task.id, 'tpc_r1');
      const afterFirst = (
        await serverDB.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
      )[0];
      expect(afterFirst.totalTopics).toBe(1);
    });

    it('returns false and leaves the counter untouched when nothing matched', async () => {
      const taskModel = new TaskModel(serverDB, userId);
      const topicModel = new TaskTopicModel(serverDB, userId);
      const task = await taskModel.create({ instruction: 'Test' });
      await serverDB.update(tasks).set({ totalTopics: 3 }).where(eq(tasks.id, task.id));

      const removed = await topicModel.remove(task.id, 'tpc_nope');
      expect(removed).toBe(false);
      const after = (await serverDB.select().from(tasks).where(eq(tasks.id, task.id)).limit(1))[0];
      expect(after.totalTopics).toBe(3);
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
