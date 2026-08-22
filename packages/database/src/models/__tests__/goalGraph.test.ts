// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';
import { TaskModel } from '../task';
import { WorkModel } from '../work';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-graph-test-user';
const otherUserId = 'goal-graph-other-user';

const goalModel = new GoalModel(serverDB, userId);
const graphModel = new GoalGraphModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('GoalGraphModel', () => {
  it('creates nodes and edges with an atomic event trail', async () => {
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Reproduce Ornith' });
    const problem = await graphModel.createNode(goal.id, {
      kind: 'problem',
      title: 'Can the published specification reproduce the system?',
    });
    const work = await graphModel.createNode(goal.id, {
      kind: 'work',
      title: 'Implement the minimal training loop',
    });

    const edge = await graphModel.createEdge(goal.id, problem!.id, work!.id, 'leads_to');
    const graph = await graphModel.getGraph(goal.id);

    expect(edge).toMatchObject({ goalId: goal.id, kind: 'leads_to' });
    expect(graph?.nodes).toHaveLength(2);
    expect(graph?.edges).toHaveLength(1);
    expect(graph?.events.map((event) => event.eventType)).toEqual(['created', 'created', 'linked']);
  });

  it('creates and resolves a durable human decision', async () => {
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Decision goal' });
    const node = await graphModel.createNode(goal.id, {
      kind: 'decision',
      title: 'Choose verifier',
    });
    const decision = await graphModel.createDecision(goal.id, node!.id, {
      authority: 'user',
      options: [
        { id: 'harden', label: 'Harden verifier' },
        { id: 'continue', label: 'Continue training' },
      ],
      question: 'Which branch should run next?',
      recommendedOptionId: 'harden',
    });

    const resolved = await graphModel.resolveDecision(
      goal.id,
      decision!.id,
      'harden',
      'Safer first',
    );
    const graph = await graphModel.getGraph(goal.id);

    expect(resolved).toMatchObject({ resolvedOptionId: 'harden', status: 'resolved' });
    expect(graph?.nodes[0]).toMatchObject({ status: 'resolved' });
    expect(graph?.decisions[0]).toMatchObject({ resolution: 'Safer first', status: 'resolved' });
  });

  it('pins an immutable Work version to an owned graph node', async () => {
    const goal = await goalModel.create({ subjectType: 'standalone', title: 'Evidence goal' });
    const node = await graphModel.createNode(goal.id, { kind: 'work', title: 'Produce evidence' });
    const task = await new TaskModel(serverDB, userId).create({ instruction: 'Produce evidence' });
    const work = await new WorkModel(serverDB, userId).registerTask({
      changeType: 'created',
      taskId: task.id,
      toolIdentifier: 'goal-test',
      toolName: 'createTask',
    });

    const link = await graphModel.attachWorkVersion(
      goal.id,
      node!.id,
      work!.currentVersionId!,
      'produced',
    );

    expect(link).toMatchObject({ nodeId: node!.id, relation: 'produced' });
    expect((await graphModel.getGraph(goal.id))?.workVersions).toHaveLength(1);
  });

  it('does not expose or mutate another user graph', async () => {
    const otherGoalModel = new GoalModel(serverDB, otherUserId);
    const otherGraphModel = new GoalGraphModel(serverDB, otherUserId);
    const goal = await otherGoalModel.create({ subjectType: 'standalone', title: 'Private graph' });
    const node = await otherGraphModel.createNode(goal.id, { kind: 'work', title: 'Private work' });

    expect(await graphModel.getGraph(goal.id)).toBeUndefined();
    expect(await graphModel.updateNodeStatus(goal.id, node!.id, 'resolved')).toBeUndefined();

    const graph = await otherGraphModel.getGraph(goal.id);
    expect(graph?.nodes[0].status).toBe('proposed');
    expect(graph?.events).toHaveLength(1);
  });
});
