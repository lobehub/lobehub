// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goalNodeWorkVersions,
  goals,
  tasks,
  users,
  works,
  workVersions,
} from '..';

const serverDB = await getTestDB();
const userId = 'goal-graph-schema-test-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

const createGoal = async () => {
  const [goal] = await serverDB
    .insert(goals)
    .values({ title: 'Reproduce the Ornith training system', userId })
    .returning();

  return goal;
};

describe('Goal Graph schema', () => {
  it('persists graph structure, a durable decision, evidence, and its audit trail', async () => {
    const goal = await createGoal();
    const [task] = await serverDB
      .insert(tasks)
      .values({
        createdByUserId: userId,
        identifier: 'ORN-1',
        instruction: 'Implement the minimal training loop',
        seq: 1,
      })
      .returning();
    const [problemNode, workNode, findingNode, decisionNode] = await serverDB
      .insert(goalNodes)
      .values([
        {
          goalId: goal.id,
          kind: 'problem',
          status: 'active',
          title: 'Is the public spec sufficient?',
        },
        {
          goalId: goal.id,
          kind: 'work',
          status: 'active',
          taskId: task.id,
          title: 'Implement the minimal training loop',
        },
        { goalId: goal.id, kind: 'finding', status: 'resolved', title: 'Verifier is vulnerable' },
        {
          goalId: goal.id,
          kind: 'decision',
          status: 'waiting',
          title: 'Strengthen verifier first',
        },
      ])
      .returning();

    await serverDB.insert(goalEdges).values([
      {
        goalId: goal.id,
        kind: 'investigates',
        sourceNodeId: workNode.id,
        targetNodeId: problemNode.id,
      },
      {
        goalId: goal.id,
        kind: 'produces',
        sourceNodeId: workNode.id,
        targetNodeId: findingNode.id,
      },
      {
        goalId: goal.id,
        kind: 'leads_to',
        sourceNodeId: findingNode.id,
        targetNodeId: decisionNode.id,
      },
    ]);
    await serverDB.insert(goalNodeDecisions).values({
      authority: 'user',
      nodeId: decisionNode.id,
      options: [
        { id: 'strengthen', label: 'Strengthen verifier' },
        { id: 'continue', label: 'Continue training' },
      ],
      question: 'Should verifier robustness be addressed before training continues?',
      recommendedOptionId: 'strengthen',
      requestedUserId: userId,
    });

    const [work] = await serverDB
      .insert(works)
      .values({
        resourceId: task.id,
        resourceType: 'task',
        title: 'Verifier attack report',
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
        type: 'task',
        userId,
        visibility: 'private',
      })
      .returning();
    const [workVersion] = await serverDB
      .insert(workVersions)
      .values({
        changeType: 'created',
        title: 'Verifier attack report',
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
        version: 1,
        workId: work.id,
      })
      .returning();
    await serverDB.insert(goalNodeWorkVersions).values({
      nodeId: findingNode.id,
      relation: 'supports',
      workVersionId: workVersion.id,
    });
    await serverDB.insert(goalEvents).values({
      actorType: 'agent',
      entityId: findingNode.id,
      entityType: 'node',
      eventType: 'resolved',
      goalId: goal.id,
      reason: 'Attack evaluation produced reproducible evidence',
      taskId: task.id,
    });

    await expect(
      serverDB.select().from(goalNodes).where(eq(goalNodes.goalId, goal.id)),
    ).resolves.toHaveLength(4);
    await expect(
      serverDB.select().from(goalEdges).where(eq(goalEdges.goalId, goal.id)),
    ).resolves.toHaveLength(3);
    await expect(
      serverDB
        .select()
        .from(goalNodeDecisions)
        .where(eq(goalNodeDecisions.nodeId, decisionNode.id)),
    ).resolves.toMatchObject([{ status: 'pending' }]);
    await expect(
      serverDB
        .select()
        .from(goalNodeWorkVersions)
        .where(eq(goalNodeWorkVersions.nodeId, findingNode.id)),
    ).resolves.toHaveLength(1);
    await expect(
      serverDB.select().from(goalEvents).where(eq(goalEvents.goalId, goal.id)),
    ).resolves.toHaveLength(1);
  });

  it('enforces the Work node to responsible Task one-to-one invariant', async () => {
    const goal = await createGoal();
    const [task] = await serverDB
      .insert(tasks)
      .values({
        createdByUserId: userId,
        identifier: 'ORN-2',
        instruction: 'Evaluate task generation strategy',
        seq: 2,
      })
      .returning();

    await expect(
      serverDB.insert(goalNodes).values({
        goalId: goal.id,
        kind: 'problem',
        taskId: task.id,
        title: 'Invalid task binding',
      }),
    ).rejects.toThrow();

    await serverDB.insert(goalNodes).values({
      goalId: goal.id,
      kind: 'work',
      taskId: task.id,
      title: 'Evaluate task generation strategy',
    });

    await expect(
      serverDB.insert(goalNodes).values({
        goalId: goal.id,
        kind: 'work',
        taskId: task.id,
        title: 'Duplicate responsible task',
      }),
    ).rejects.toThrow();
  });

  it('rejects self-referencing edges and out-of-range confidence', async () => {
    const goal = await createGoal();
    const [node] = await serverDB
      .insert(goalNodes)
      .values({ goalId: goal.id, kind: 'problem', title: 'Training task quality' })
      .returning();

    await expect(
      serverDB.insert(goalEdges).values({
        goalId: goal.id,
        kind: 'depends_on',
        sourceNodeId: node.id,
        targetNodeId: node.id,
      }),
    ).rejects.toThrow();
    await expect(
      serverDB.insert(goalNodes).values({
        confidence: '1.001',
        goalId: goal.id,
        kind: 'finding',
        title: 'Invalid confidence',
      }),
    ).rejects.toThrow();
  });

  it('rejects edges whose endpoints belong to another Goal Graph', async () => {
    const goalA = await createGoal();
    const goalB = await createGoal();
    const [nodeA, nodeB] = await serverDB
      .insert(goalNodes)
      .values([
        { goalId: goalA.id, kind: 'problem', title: 'Goal A problem' },
        { goalId: goalB.id, kind: 'finding', title: 'Goal B finding' },
      ])
      .returning();

    await expect(
      serverDB.insert(goalEdges).values({
        goalId: goalA.id,
        kind: 'supports',
        sourceNodeId: nodeA.id,
        targetNodeId: nodeB.id,
      }),
    ).rejects.toThrow();
  });
});
