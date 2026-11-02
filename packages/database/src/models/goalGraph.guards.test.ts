// @vitest-environment node
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { goalEvents, goalNodeDecisions, goalNodes, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { createProxyTestDB } from './__tests__/_proxyTestDB';
import { GoalModel } from './goal';
import { GoalGraphModel } from './goalGraph';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-graph-guards-user';
const graphModel = new GoalGraphModel(serverDB, userId);

const options = [
  { id: 'ship', label: 'Ship it' },
  { id: 'hold', label: 'Hold' },
];

const pendingDecision = async () => {
  const goal = await new GoalModel(serverDB, userId).create({
    subjectType: 'standalone',
    title: 'Decision guards',
  });
  const node = await graphModel.createNode(goal.id, { kind: 'decision', title: 'Ship?' });
  const decision = await graphModel.createDecision(goal.id, node!.id, {
    authority: 'user',
    options,
    question: 'Ship it?',
  });
  return { decision: decision!, goal, node: node! };
};

/**
 * A graph model whose "is this decision still pending" read keeps returning `decisionId`
 * after the row was settled — the view a writer that skipped the goal lock would leave
 * between that read and the guarded UPDATE. The UPDATE itself runs against the real row;
 * `writes` records it, so a test can tell the guard after it from an earlier return.
 */
const graphSeeingPending = (decisionId: string) => {
  const writes: string[] = [];
  const graph = new GoalGraphModel(
    createProxyTestDB(serverDB, (query, result) => {
      if (query.startsWith('update "goal_node_decisions"')) writes.push(query);
      return query.startsWith('select "goal_node_decisions"."id" from "goal_node_decisions"')
        ? [[decisionId]]
        : result.rows;
    }),
    userId,
  );
  return { graph, writes };
};

const decisionEvents = async (goalId: string, decisionId: string) =>
  serverDB
    .select({ eventType: goalEvents.eventType })
    .from(goalEvents)
    .where(and(eq(goalEvents.goalId, goalId), eq(goalEvents.entityId, decisionId)));

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('GoalGraphModel decision guards', () => {
  it('resolveDecision returns undefined and leaves the node alone when the decision settled under it', async () => {
    const { decision, goal, node } = await pendingDecision();
    // Settled by a writer that did not take the goal lock first.
    await serverDB
      .update(goalNodeDecisions)
      .set({ resolvedAt: new Date(), resolvedOptionId: 'hold', status: 'resolved' })
      .where(eq(goalNodeDecisions.id, decision.id));

    const seeing = graphSeeingPending(decision.id);
    const result = await seeing.graph.resolveDecision(goal.id, decision.id, 'ship', 'late answer');

    expect(result).toBeUndefined();
    // The guarded UPDATE was issued and matched nothing.
    expect(seeing.writes).toHaveLength(1);
    const [stored] = await serverDB
      .select()
      .from(goalNodeDecisions)
      .where(eq(goalNodeDecisions.id, decision.id));
    expect(stored).toMatchObject({
      resolution: null,
      resolvedOptionId: 'hold',
      status: 'resolved',
    });
    const [storedNode] = await serverDB.select().from(goalNodes).where(eq(goalNodes.id, node.id));
    expect(storedNode.status).toBe(node.status);
    expect(storedNode.resolvedAt).toBeNull();
    expect((await decisionEvents(goal.id, decision.id)).map((e) => e.eventType)).toEqual([
      'created',
    ]);
  });

  it('cancelDecision returns undefined and does not retire the node when the decision settled under it', async () => {
    const { decision, goal, node } = await pendingDecision();
    await serverDB
      .update(goalNodeDecisions)
      .set({ resolvedAt: new Date(), resolvedOptionId: 'ship', status: 'resolved' })
      .where(eq(goalNodeDecisions.id, decision.id));

    const seeing = graphSeeingPending(decision.id);
    const result = await seeing.graph.cancelDecision(goal.id, decision.id, 'question went away');

    expect(result).toBeUndefined();
    // The guarded UPDATE was issued and matched nothing.
    expect(seeing.writes).toHaveLength(1);
    const [stored] = await serverDB
      .select()
      .from(goalNodeDecisions)
      .where(eq(goalNodeDecisions.id, decision.id));
    expect(stored).toMatchObject({
      canceledAt: null,
      resolvedOptionId: 'ship',
      status: 'resolved',
    });
    const [storedNode] = await serverDB.select().from(goalNodes).where(eq(goalNodes.id, node.id));
    expect(storedNode.status).not.toBe('retired');
    expect((await decisionEvents(goal.id, decision.id)).map((e) => e.eventType)).toEqual([
      'created',
    ]);
  });
});
