// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { goalEvents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-rename-problem-user';
const otherUserId = 'goal-rename-problem-other';

const goalModel = new GoalModel(serverDB, userId);
const graphModel = new GoalGraphModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

/** A standalone goal with its root question seeded from the goal title. */
const createGoalWithProblem = async (title: string) => {
  const goal = await goalModel.create({ subjectType: 'standalone', title });
  const node = await graphModel.createNode(goal.id, { kind: 'problem', title });
  if (!node) throw new Error('problem node was not created');
  return { goal, node };
};

describe('GoalGraphModel.renameProblemNode', () => {
  it('renames the root question and records an updated event', async () => {
    const { goal, node } = await createGoalWithProblem('Ship the scheduler');

    const renamed = await graphModel.renameProblemNode(
      goal.id,
      'Ship the scheduler',
      'Ship the scheduler with retries',
    );

    expect(renamed).toMatchObject({ id: node.id, title: 'Ship the scheduler with retries' });

    const events = await serverDB
      .select()
      .from(goalEvents)
      .where(and(eq(goalEvents.goalId, goal.id), eq(goalEvents.eventType, 'updated')));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityId: node.id,
      entityType: 'node',
      reason: 'Goal renamed',
      taskId: null,
    });
  });

  it('leaves the graph alone when the question no longer carries the old title', async () => {
    const { goal, node } = await createGoalWithProblem('Ship the scheduler');

    expect(
      await graphModel.renameProblemNode(goal.id, 'a title it never had', 'ignored'),
    ).toBeUndefined();

    const events = await serverDB
      .select()
      .from(goalEvents)
      .where(and(eq(goalEvents.goalId, goal.id), eq(goalEvents.eventType, 'updated')));
    expect(events).toHaveLength(0);
    expect(node.title).toBe('Ship the scheduler');
  });

  it('returns undefined for a goal the user does not own', async () => {
    expect(await graphModel.renameProblemNode('goal-missing', 'from', 'to')).toBeUndefined();
  });
});
