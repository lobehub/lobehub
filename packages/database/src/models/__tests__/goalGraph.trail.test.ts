// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goalNodeWorkVersions,
  goals,
  tasks,
  users,
  works,
  workVersions,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-trail-user';
const otherUserId = 'goal-trail-other';

const graphModel = new GoalGraphModel(serverDB, userId);

const createGoal = async (title = 'Trail goal', owner = userId) =>
  new GoalModel(serverDB, owner).create({ subjectType: 'standalone', title });

/** Goals start in `planning`; only a `draft` may lose nodes. */
const asDraft = async (goalId: string) => {
  await serverDB.update(goals).set({ status: 'draft' }).where(eq(goals.id, goalId));
};

const seedEvent = async (
  goalId: string,
  overrides: Partial<typeof goalEvents.$inferInsert> = {},
) => {
  const [event] = await serverDB
    .insert(goalEvents)
    .values({
      actorId: userId,
      actorType: 'user',
      entityId: 'entity-1',
      entityType: 'node',
      eventType: 'created',
      goalId,
      ...overrides,
    })
    .returning();
  return event;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

describe('GoalGraphModel.listEvents', () => {
  it('returns undefined for a goal the caller cannot see', async () => {
    const theirs = await createGoal('Theirs', otherUserId);

    await expect(graphModel.listEvents(theirs.id, { limit: 10 })).resolves.toBeUndefined();
    await expect(
      graphModel.listEvents('00000000-0000-4000-8000-0000000000ff', { limit: 10 }),
    ).resolves.toBeUndefined();
  });

  it('pages newest first across one-millisecond ties without dropping a row', async () => {
    const goal = await createGoal();
    const ids = [
      '00000000-0000-4000-8000-00000000000a',
      '00000000-0000-4000-8000-00000000000b',
      '00000000-0000-4000-8000-00000000000c',
    ];
    // Same instant for all three: a cursor that compared the raw column against a
    // millisecond cursor would leave the leftover row unreachable.
    for (const id of ids) {
      await seedEvent(goal.id, { createdAt: new Date('2026-04-01T00:00:00.000Z'), id });
    }

    const first = await graphModel.listEvents(goal.id, { limit: 2 });
    const second = await graphModel.listEvents(goal.id, {
      cursor: first!.nextCursor,
      limit: 2,
    });

    expect(first!.events.map((event) => event.id)).toEqual([ids[2], ids[1]]);
    expect(first!.nextCursor).toMatchObject({ id: ids[1] });
    expect(second!.events.map((event) => event.id)).toEqual([ids[0]]);
    expect(second!.nextCursor).toBeUndefined();
  });

  it('filters by entity and event type, and stops at an exact page', async () => {
    const goal = await createGoal();
    await seedEvent(goal.id, { entityType: 'node', eventType: 'created' });
    await seedEvent(goal.id, { entityType: 'node', eventType: 'updated' });
    await seedEvent(goal.id, { entityType: 'goal', eventType: 'created' });

    const nodes = await graphModel.listEvents(goal.id, { entityType: 'node', limit: 10 });
    const created = await graphModel.listEvents(goal.id, { eventType: 'created', limit: 10 });
    const both = await graphModel.listEvents(goal.id, {
      entityType: 'node',
      eventType: 'created',
      limit: 1,
    });

    expect(nodes!.events).toHaveLength(2);
    expect(created!.events).toHaveLength(2);
    expect(both!.events).toHaveLength(1);
    expect(both!.nextCursor).toBeUndefined();
  });
});

describe('GoalGraphModel.recordGoalUpdate', () => {
  it('appends an updated event on the goal with its reason and operation', async () => {
    const goal = await createGoal();

    await graphModel.recordGoalUpdate(goal.id, {
      operationId: 'op-bind',
      reason: 'bound to topic',
    });

    const { events } = (await graphModel.listEvents(goal.id, { limit: 10 }))!;
    expect(events[0]).toMatchObject({
      actorId: userId,
      actorType: 'user',
      entityId: goal.id,
      entityType: 'goal',
      eventType: 'updated',
      operationId: 'op-bind',
      reason: 'bound to topic',
    });
  });
});

describe('GoalGraphModel.listProducedWorkIds', () => {
  it('returns the Works declared as produced, ignoring other relations', async () => {
    const goal = await createGoal();
    const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Deliver' });
    const [producedWork] = await serverDB
      .insert(works)
      .values({
        resourceType: 'task',
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
        type: 'task',
        userId,
        visibility: 'private',
      })
      .returning();
    const [relatedWork] = await serverDB
      .insert(works)
      .values({
        resourceType: 'task',
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
        type: 'task',
        userId,
        visibility: 'private',
      })
      .returning();
    const versions = await serverDB
      .insert(workVersions)
      .values([
        {
          changeType: 'created',
          toolIdentifier: 'lobe-task',
          toolName: 'createTask',
          version: 1,
          workId: producedWork.id,
        },
        {
          changeType: 'created',
          toolIdentifier: 'lobe-task',
          toolName: 'createTask',
          version: 1,
          workId: relatedWork.id,
        },
      ])
      .returning();
    await serverDB.insert(goalNodeWorkVersions).values([
      { nodeId: node!.id, relation: 'produced', workVersionId: versions[0].id },
      { nodeId: node!.id, relation: 'related', workVersionId: versions[1].id },
    ]);

    const produced = await graphModel.listProducedWorkIds(goal.id);

    expect([...produced]).toEqual([producedWork.id]);
  });
});

describe('GoalGraphModel.countRunningTasks', () => {
  it('counts only live task nodes, not retired or untracked ones', async () => {
    const goal = await createGoal();
    const seedTask = async (id: string, status: string) => {
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id,
        identifier: id,
        instruction: 'run it',
        seq: 1,
        status,
      });
      return id;
    };
    await seedTask('task-running', 'running');
    await seedTask('task-scheduled', 'scheduled');
    await seedTask('task-done', 'completed');
    await serverDB.insert(goalNodes).values([
      { goalId: goal.id, kind: 'task', taskId: 'task-running', title: 'a' },
      { goalId: goal.id, kind: 'task', taskId: 'task-scheduled', title: 'b' },
      { goalId: goal.id, kind: 'task', taskId: 'task-done', title: 'c' },
      { goalId: goal.id, kind: 'task', title: 'not dispatched' },
      { goalId: goal.id, kind: 'problem', title: 'not a task' },
    ]);

    await expect(graphModel.countRunningTasks(goal.id)).resolves.toBe(2);
  });
});

describe('GoalGraphModel.removeDraftNodes', () => {
  it('removes unbound nodes of a draft and records one unlinked event each', async () => {
    const goal = await createGoal();
    await asDraft(goal.id);
    const first = await graphModel.createNode(goal.id, { kind: 'finding', title: 'drop me' });
    const second = await graphModel.createNode(goal.id, { kind: 'finding', title: 'keep me' });

    const removed = await graphModel.removeDraftNodes(goal.id, [first!.id], 'planner re-scope');

    expect(removed).toBe(1);
    const { events } = (await graphModel.getGraph(goal.id))!;
    expect(events[0]).toMatchObject({
      entityId: first!.id,
      eventType: 'unlinked',
      reason: 'planner re-scope',
    });
    expect(
      events.find((event) => event.entityId === second!.id && event.eventType === 'unlinked'),
    ).toBeUndefined();
  });

  it('returns 0 for an empty list or a goal it cannot see', async () => {
    const goal = await createGoal();
    await asDraft(goal.id);
    const theirs = await createGoal('Theirs', otherUserId);

    await expect(graphModel.removeDraftNodes(goal.id, [], 'nothing')).resolves.toBe(0);
    await expect(graphModel.removeDraftNodes(theirs.id, ['x'], 'nope')).resolves.toBe(0);
  });

  it('refuses nodes bound to a task and goals that already started', async () => {
    const goal = await createGoal();
    await asDraft(goal.id);
    await serverDB.insert(tasks).values({
      createdByUserId: userId,
      id: 'task-bound',
      identifier: 'task-bound',
      instruction: 'run it',
      seq: 1,
      status: 'backlog',
    });
    const bound = await graphModel.createNode(goal.id, { kind: 'task', title: 'bound' });
    await serverDB
      .update(goalNodes)
      .set({ taskId: 'task-bound' })
      .where(eq(goalNodes.id, bound!.id));

    await expect(graphModel.removeDraftNodes(goal.id, [bound!.id], 'nope')).rejects.toThrow(
      /Only unbound nodes/,
    );

    const started = await createGoal('Started');
    await serverDB.update(goals).set({ status: 'active' }).where(eq(goals.id, started.id));
    await expect(graphModel.removeDraftNodes(started.id, ['x'], 'nope')).rejects.toThrow(
      /Only a draft Goal/,
    );
  });
});

describe('GoalGraphModel.updateNodeDescription', () => {
  it('writes the description and the confidence when one is given', async () => {
    const goal = await createGoal();
    const node = await graphModel.createNode(goal.id, { kind: 'problem', title: 'Problem' });

    const updated = await graphModel.updateNodeDescription(goal.id, node!.id, 'refined', 0.8);
    const withoutConfidence = await graphModel.createNode(goal.id, {
      kind: 'finding',
      title: 'Finding',
    });
    await graphModel.updateNodeDescription(goal.id, withoutConfidence!.id, 'plain');

    expect(updated).toMatchObject({ description: 'refined', confidence: '0.800' });
    const plain = await serverDB.query.goalNodes.findFirst({
      where: eq(goalNodes.id, withoutConfidence!.id),
    });
    expect(plain).toMatchObject({ confidence: null, description: 'plain' });
    await expect(
      graphModel.updateNodeDescription(goal.id, '00000000-0000-4000-8000-0000000000ff', 'x'),
    ).resolves.toBeUndefined();
  });
});

describe('GoalGraphModel decision maintenance', () => {
  const options = [
    { id: 'ship', label: 'Ship it' },
    { id: 'hold', label: 'Hold' },
  ];

  const pendingDecision = async () => {
    const goal = await createGoal('Decision goal');
    const node = await graphModel.createNode(goal.id, { kind: 'decision', title: 'Ship?' });
    const decision = await graphModel.createDecision(goal.id, node!.id, {
      authority: 'user',
      options,
      question: 'Ship it?',
    });
    return { decision: decision!, goal, node: node! };
  };

  /**
   * A pending decision filed under a goal the caller does not own.
   *
   * `pendingDecision` creates both halves as the caller, so the goal/decision
   * pair itself is what a foreign call would be rejected by. Here the pair
   * belongs together under `owner`, which leaves only the ownership check
   * between the caller and the decision.
   */
  const foreignPendingDecision = async (owner: string) => {
    const graph = new GoalGraphModel(serverDB, owner);
    const goal = await createGoal('Decision goal', owner);
    const node = await graph.createNode(goal.id, { kind: 'decision', title: 'Ship?' });
    const decision = await graph.createDecision(goal.id, node!.id, {
      authority: 'user',
      options,
      question: 'Ship it?',
    });
    return { decision: decision!, goal, node: node! };
  };

  it('rewrites the options while the decision is pending', async () => {
    const { decision, goal } = await pendingDecision();

    const updated = await graphModel.updatePendingDecisionOptions(goal.id, decision.id, [
      { id: 'ship', label: 'Ship it now' },
    ]);

    expect(updated?.options).toEqual([{ id: 'ship', label: 'Ship it now' }]);
    await expect(
      graphModel.updatePendingDecisionOptions(goal.id, decision.id, options),
    ).resolves.not.toBeUndefined();
  });

  it('leaves a settled decision on the options it was answered against', async () => {
    const { decision, goal } = await pendingDecision();
    await graphModel.resolveDecision(goal.id, decision.id, 'ship');

    await expect(
      graphModel.updatePendingDecisionOptions(goal.id, decision.id, options),
    ).resolves.toBeUndefined();
  });

  it('cancels a pending decision and retires its node', async () => {
    const { decision, goal, node } = await pendingDecision();

    const canceled = await graphModel.cancelDecision(goal.id, decision.id, 'question went away');

    expect(canceled).toMatchObject({ id: decision.id, status: 'canceled' });
    const reloaded = await serverDB.query.goalNodes.findFirst({
      where: eq(goalNodes.id, node.id),
    });
    expect(reloaded?.status).toBe('retired');
    const { events } = (await graphModel.getGraph(goal.id))!;
    expect(events[0]).toMatchObject({
      entityId: decision.id,
      eventType: 'retired',
      reason: 'question went away',
    });
    // Nobody picked an option — a second cancel has nothing left to settle.
    await expect(graphModel.cancelDecision(goal.id, decision.id, 'again')).resolves.toBeUndefined();
  });

  it('refuses decisions on a goal it cannot see', async () => {
    const { decision, goal, node } = await foreignPendingDecision(otherUserId);

    await expect(graphModel.cancelDecision(goal.id, decision.id, 'nope')).resolves.toBeUndefined();
    await expect(
      graphModel.updatePendingDecisionOptions(goal.id, decision.id, options),
    ).resolves.toBeUndefined();

    // The decision really does hang off the goal the call named — only the
    // owner check stopped it, so a dropped `ownedGoal` would reach real rows.
    const reloaded = await serverDB.query.goalNodeDecisions.findFirst({
      where: eq(goalNodeDecisions.nodeId, node.id),
    });
    expect(reloaded).toMatchObject({ id: decision.id, status: 'pending' });
    expect(reloaded?.canceledAt).toBeNull();
  });
});
