// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { taskTopics, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskTopicModel } from '../taskTopic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-topic-handoff-test-user-id';

const createTopic = async (id: string, uid = userId) => {
  await serverDB.insert(topics).values({ id, userId: uid }).onConflictDoNothing();
  return id;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskTopicModel — handoff content, run cost rollup and review edges', () => {
  it('updateHandoffContent patches only the content key', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const topicModel = new TaskTopicModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Test' });
    await createTopic('tpc_handoff');

    await topicModel.add(task.id, 'tpc_handoff', { seq: 1 });
    await topicModel.updateHandoff(task.id, 'tpc_handoff', {
      keyFindings: ['kept'],
      nextAction: 'Next',
      summary: 'Sum',
      title: 'T',
    });
    await topicModel.updateHandoffContent(task.id, 'tpc_handoff', 'final output');

    const [row] = await serverDB
      .select()
      .from(taskTopics)
      .where(eq(taskTopics.taskId, task.id))
      .limit(1);
    expect(row.handoff).toMatchObject({ content: 'final output', summary: 'Sum' });
  });

  it('sumRunCostByTaskIds returns an empty rollup for no tasks', async () => {
    const topicModel = new TaskTopicModel(serverDB, userId);

    expect(await topicModel.sumRunCostByTaskIds([])).toEqual({
      byTask: [],
      runs: 0,
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    });
  });

  it('sumRunCostByTaskIds folds settled runs per task', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const topicModel = new TaskTopicModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Test' });
    await createTopic('tpc_cost_1');
    await createTopic('tpc_cost_2');
    await serverDB
      .update(topics)
      .set({ totalCost: 1.5, totalInputTokens: 10, totalOutputTokens: 20, totalTokens: 30 })
      .where(eq(topics.id, 'tpc_cost_1'));
    await serverDB.update(topics).set({ totalInputTokens: 5 }).where(eq(topics.id, 'tpc_cost_2'));
    await topicModel.add(task.id, 'tpc_cost_1', { seq: 1 });
    await topicModel.add(task.id, 'tpc_cost_2', { seq: 2 });

    const rollup = await topicModel.sumRunCostByTaskIds([task.id]);

    expect(rollup.runs).toBe(2);
    expect(rollup.totalCost).toBeCloseTo(1.5, 6);
    expect(rollup.totalInputTokens).toBe(15);
    expect(rollup.byTask).toHaveLength(1);
    expect(rollup.byTask[0].taskId).toBe(task.id);
  });

  it('findRunningByTaskIds and findWithHandoffByTaskIds short-circuit empty input', async () => {
    const topicModel = new TaskTopicModel(serverDB, userId);

    expect(await topicModel.findRunningByTaskIds([])).toEqual([]);
    expect(await topicModel.findWithHandoffByTaskIds([], 10)).toEqual([]);
  });

  it('updateReview stores a failed verdict as 0', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const topicModel = new TaskTopicModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Test' });
    await createTopic('tpc_review');

    await topicModel.add(task.id, 'tpc_review', { seq: 1 });
    await topicModel.updateReview(task.id, 'tpc_review', {
      iteration: 2,
      passed: false,
      score: 12,
      scores: [],
    });

    const [row] = await serverDB
      .select()
      .from(taskTopics)
      .where(eq(taskTopics.taskId, task.id))
      .limit(1);
    expect(row.reviewPassed).toBe(0);
    expect(row.reviewIteration).toBe(2);
  });

  it('add rejects when the parent task does not exist', async () => {
    const topicModel = new TaskTopicModel(serverDB, userId);
    await createTopic('tpc_orphan');

    await expect(topicModel.add('missing-task-id', 'tpc_orphan', { seq: 1 })).rejects.toThrow();
  });

  it('cancelRunningByTaskIds skips rows without a topic id', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const topicModel = new TaskTopicModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Test' });
    await serverDB
      .insert(taskTopics)
      .values({ seq: 1, status: 'running', taskId: task.id, topicId: null, userId });

    const canceled = await topicModel.cancelRunningByTaskIds([task.id]);

    expect(canceled).toHaveLength(1);
    expect(canceled[0].topicId).toBeNull();
  });
});
