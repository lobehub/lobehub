// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { goalEvents, goals, users } from '../../schemas';
import { GoalModel } from '../goal';
import { GoalExplorationModel, goalExplorationSnapshot } from '../goalExploration';
import { GoalGraphModel } from '../goalGraph';

const db = await getTestDB();
const userId = 'exploration-coverage-owner';
const graphModel = new GoalGraphModel(db, userId);
const model = new GoalExplorationModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

const createExplorationGoal = () =>
  new GoalModel(db, userId).create({
    config: { exploration: { instruction: 'Compare results', maxExperiments: 3 } },
    status: 'running',
    subjectType: 'standalone',
    title: 'Explore',
  });

const snapshotOf = async (goalId: string) =>
  goalExplorationSnapshot((await graphModel.getGraph(goalId))!);

const readGoal = async (goalId: string) =>
  (await db.select().from(goals).where(eq(goals.id, goalId)))[0];

describe('goalExplorationSnapshot', () => {
  it('hashes a goal that has no exploration policy', async () => {
    const goal = await new GoalModel(db, userId).create({
      subjectType: 'standalone',
      title: 'No policy',
    });
    const graph = (await graphModel.getGraph(goal.id))!;

    const snapshot = goalExplorationSnapshot(graph);

    expect(snapshot).toMatch(/^[\da-f]{64}$/);
    // Same input, same hash.
    expect(goalExplorationSnapshot(graph)).toBe(snapshot);
  });
});

describe('GoalExplorationModel coverage', () => {
  it('does not lease when the graph moved since the caller took its snapshot', async () => {
    const goal = await createExplorationGoal();
    const stale = await snapshotOf(goal.id);
    await graphModel.createNode(goal.id, { kind: 'problem', title: 'Added later' });

    expect(await model.claim(goal.id, stale)).toBeUndefined();
    expect((await readGoal(goal.id)).config?.exploration?.checkpoint).toBeUndefined();
  });

  it('refuses to expand when the goal has no question to answer', async () => {
    const goal = await createExplorationGoal();
    const parent = await graphModel.createNode(goal.id, {
      kind: 'task',
      status: 'resolved',
      title: 'Baseline',
    });
    const checkpoint = await model.claim(goal.id, await snapshotOf(goal.id));

    await expect(
      model.apply(goal.id, checkpoint!.token, {
        action: 'expand',
        instruction: 'Try another way',
        parentNodeId: parent!.id,
        reason: 'Promising',
        title: 'Alternative',
      }),
    ).rejects.toThrow('Exploration requires a question');
    // The transaction rolled back: no node was added.
    expect((await graphModel.getGraph(goal.id))?.nodes).toHaveLength(1);
  });

  describe('fail', () => {
    it('ignores a caller whose lease token is not the current one', async () => {
      const goal = await createExplorationGoal();
      const checkpoint = await model.claim(goal.id, await snapshotOf(goal.id));

      await model.fail(goal.id, 'not-the-token', 'planner crashed');

      const row = await readGoal(goal.id);
      expect(row.status).toBe('running');
      expect(row.config?.exploration?.checkpoint?.token).toBe(checkpoint!.token);
    });

    it('parks the goal and clears the lease for the current lease owner', async () => {
      const goal = await createExplorationGoal();
      const checkpoint = await model.claim(goal.id, await snapshotOf(goal.id));

      await model.fail(goal.id, checkpoint!.token, 'planner crashed');

      const row = await readGoal(goal.id);
      expect(row.status).toBe('paused');
      expect(row.config?.exploration).toEqual({
        instruction: 'Compare results',
        maxExperiments: 3,
      });
      const events = await db.select().from(goalEvents).where(eq(goalEvents.goalId, goal.id));
      expect(events).toEqual([
        expect.objectContaining({
          entityType: 'goal',
          eventType: 'updated',
          reason: 'planner crashed',
        }),
      ]);
    });
  });
});
