// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, goalNodes, goals, tasks, taskTopics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalMarkModel } from '../goalMark';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-mark-user';
const otherUserId = 'goal-mark-other-user';
const agentId = 'goal-mark-agent';

const model = new GoalMarkModel(serverDB, userId);
const otherModel = new GoalMarkModel(serverDB, otherUserId);

let seq = 0;

const seedRun = async (options: {
  assigneeAgentId?: string | null;
  kind?: 'pattern' | 'task';
  operationId: string;
  owner?: string;
  taskId: string;
}) => {
  const owner = options.owner ?? userId;
  seq += 1;

  const [goal] = await serverDB
    .insert(goals)
    .values({ title: `Goal ${options.taskId}`, userId: owner })
    .returning();
  const [task] = await serverDB
    .insert(tasks)
    .values({
      assigneeAgentId: options.assigneeAgentId ?? null,
      createdByUserId: owner,
      id: options.taskId,
      identifier: `GM-${seq}`,
      instruction: 'Run the task',
      seq,
    })
    .returning();
  const [node] = await serverDB
    .insert(goalNodes)
    .values({
      goalId: goal.id,
      kind: options.kind ?? 'task',
      taskId: task.id,
      title: `Node ${options.taskId}`,
    })
    .returning();
  await serverDB.insert(taskTopics).values({
    operationId: options.operationId,
    seq: 1,
    taskId: task.id,
    userId: owner,
  });

  return { goalId: goal.id, nodeId: node.id, taskId: task.id };
};

const confidenceOf = async (nodeId: string) => {
  const [row] = await serverDB
    .select({ confidence: goalNodes.confidence })
    .from(goalNodes)
    .where(eq(goalNodes.id, nodeId));
  return row?.confidence;
};

beforeEach(async () => {
  seq = 0;
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('GoalMarkModel.findRunNode', () => {
  it('resolves the Task node a run works for, with the agent it marks as', async () => {
    const seeded = await seedRun({
      assigneeAgentId: agentId,
      operationId: 'op-owned',
      taskId: 'goal-mark-task-1',
    });

    expect(await model.findRunNode('op-owned')).toEqual({
      agentId,
      goalId: seeded.goalId,
      nodeId: seeded.nodeId,
      taskId: seeded.taskId,
    });
  });

  it('omits the agent when the Task has no assignee', async () => {
    const seeded = await seedRun({ operationId: 'op-agentless', taskId: 'goal-mark-task-2' });

    expect(await model.findRunNode('op-agentless')).toEqual({
      agentId: undefined,
      goalId: seeded.goalId,
      nodeId: seeded.nodeId,
      taskId: seeded.taskId,
    });
  });

  it('returns undefined for a run nobody owns the Goal of', async () => {
    await seedRun({ operationId: 'op-someone-else', taskId: 'goal-mark-task-3' });

    expect(await otherModel.findRunNode('op-someone-else')).toBeUndefined();
  });

  it('returns undefined for a run whose Task is not bound to a Goal node', async () => {
    await seedRun({ operationId: 'op-bound', taskId: 'goal-mark-task-4' });

    expect(await model.findRunNode('op-unbound')).toBeUndefined();
  });
});

describe('GoalMarkModel.setConfidence', () => {
  it('stores the confidence on a mark node', async () => {
    const seeded = await seedRun({
      kind: 'pattern',
      operationId: 'op-pattern',
      taskId: 'goal-mark-task-5',
    });

    expect(await model.setConfidence(seeded.goalId, seeded.nodeId, 0.75)).toEqual({
      id: seeded.nodeId,
    });
    expect(await confidenceOf(seeded.nodeId)).toBe('0.750');
  });

  it('leaves an ordinary task node alone', async () => {
    const seeded = await seedRun({ operationId: 'op-task', taskId: 'goal-mark-task-6' });

    expect(await model.setConfidence(seeded.goalId, seeded.nodeId, 0.5)).toBeUndefined();
    expect(await confidenceOf(seeded.nodeId)).toBeNull();
  });

  it('returns undefined for a Goal the caller does not own', async () => {
    const seeded = await seedRun({
      kind: 'pattern',
      operationId: 'op-foreign',
      taskId: 'goal-mark-task-7',
    });

    expect(await otherModel.setConfidence(seeded.goalId, seeded.nodeId, 0.9)).toBeUndefined();
    expect(await confidenceOf(seeded.nodeId)).toBeNull();
  });
});
