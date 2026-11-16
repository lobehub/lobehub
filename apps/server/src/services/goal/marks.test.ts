// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { goalExplorationSnapshot } from '@/database/models/goalExploration';
import { TaskModel } from '@/database/models/task';
import { taskTopics, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { GoalService } from './GoalService';
import { managerSnapshot } from './manager/turnState';
import {
  activeMarks,
  GoalMarkService,
  markConfidence,
  MARKS_IN_PROMPT,
  marksForPrompt,
} from './marks';
import { registerGoalServiceTestCleanup } from './testUtils';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-mark-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

/** A goal whose first Task has a run, so that run's operation resolves to its node. */
const goalWithRun = async (operationId: string) => {
  const service = new GoalService(serverDB, userId);
  const graph = await service.create({ tasks: ['Migrate the store'], title: 'Marks goal' });
  const { nodeId, taskId } = await service.tick(graph.goal.id);
  const topicId = `tpc_${operationId}`;
  await serverDB.insert(topics).values({ id: topicId, userId });
  await serverDB
    .insert(taskTopics)
    .values({ operationId, seq: 1, taskId: taskId!, topicId, userId });
  return { goalId: graph.goal.id, nodeId: nodeId!, service };
};

describe('markConfidence', () => {
  it('starts an unjudged mark at an even chance and never pins it', () => {
    expect(markConfidence(0, 0)).toBe(0.5);
    expect(markConfidence(2, 0)).toBe(0.75);
    expect(markConfidence(0, 2)).toBe(0.25);
    expect(markConfidence(100, 0)).toBeLessThan(1);
  });
});

describe('GoalMarkService', () => {
  it('finds the Goal Task a run works for from its operation, and nothing for a stranger', async () => {
    const { goalId, nodeId } = await goalWithRun('op_mark_resolve');
    const marks = new GoalMarkService(serverDB, userId);

    expect(await marks.runNode('op_mark_resolve')).toMatchObject({ goalId, nodeId });
    expect(await marks.runNode('op_unknown')).toBeUndefined();
    // Another user's token never reaches this run's goal.
    expect(
      await new GoalMarkService(serverDB, 'someone-else').runNode('op_mark_resolve'),
    ).toBeUndefined();
  });

  it('hangs a mark off the run that left it and makes it Goal-wide', async () => {
    const { goalId, nodeId, service } = await goalWithRun('op_mark_add');
    const marks = new GoalMarkService(serverDB, userId);

    const mark = await marks.add(
      goalId,
      { description: 'Run `bun i` first', kind: 'pattern', title: '  Missing   dep →  install ' },
      { nodeId },
    );

    const graph = await service.graph(goalId);
    expect(graph.nodes.find((node) => node.id === mark.id)).toMatchObject({
      kind: 'pattern',
      status: 'active',
      title: 'Missing dep → install',
    });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ kind: 'produces', sourceNodeId: nodeId, targetNodeId: mark.id }),
    );
    // Not contained in any experiment: every Task of the goal sees it.
    expect(
      graph.edges.some((edge) => edge.kind === 'contains' && edge.targetNodeId === mark.id),
    ).toBe(false);
  });

  it('moves a mark’s confidence with each run that judged it, once per verdict', async () => {
    const { goalId, nodeId, service } = await goalWithRun('op_mark_judge');
    const marks = new GoalMarkService(serverDB, userId);
    const mark = await marks.add(goalId, { kind: 'tool', title: 'codemod.ts' });

    expect((await marks.judge(goalId, mark.id, 'confirms', { nodeId })).confidence).toBeCloseTo(
      2 / 3,
    );
    // The same run confirming again changes nothing.
    expect((await marks.judge(goalId, mark.id, 'confirms', { nodeId })).confirms).toBe(1);
    const refuted = await marks.judge(goalId, mark.id, 'refutes', { nodeId });
    expect(refuted).toMatchObject({ confirms: 1, refutes: 1 });
    expect(refuted.confidence).toBe(0.5);

    const stored = (await service.graph(goalId)).nodes.find((node) => node.id === mark.id);
    expect(Number(stored?.confidence)).toBe(0.5);
  });

  it('refuses to judge something that is not a mark', async () => {
    const { goalId, nodeId } = await goalWithRun('op_mark_refuse');
    const marks = new GoalMarkService(serverDB, userId);

    await expect(marks.judge(goalId, nodeId, 'confirms', { nodeId })).rejects.toThrow(/No mark/);
  });

  it('keeps marks out of the snapshots a planner’s answer is checked against', async () => {
    const { goalId, nodeId, service } = await goalWithRun('op_mark_snapshot');
    const before = await service.graph(goalId);
    const marks = new GoalMarkService(serverDB, userId);

    const mark = await marks.add(
      goalId,
      { kind: 'hazard', title: 'Do not touch index.ts' },
      { nodeId },
    );
    await marks.judge(goalId, mark.id, 'confirms', { nodeId });

    const after = await service.graph(goalId);
    expect(after.nodes.length).toBeGreaterThan(before.nodes.length);
    expect(goalExplorationSnapshot(after)).toBe(goalExplorationSnapshot(before));
    expect(managerSnapshot(after)).toBe(managerSnapshot(before));
  });

  it('hands a run hazards first, then the most trusted, and drops retired or refuted ones', async () => {
    const { goalId, nodeId, service } = await goalWithRun('op_mark_rank');
    const marks = new GoalMarkService(serverDB, userId);
    const plain = await marks.add(goalId, { kind: 'pattern', title: 'plain' });
    const trusted = await marks.add(goalId, { kind: 'pattern', title: 'trusted' });
    const hazard = await marks.add(goalId, { kind: 'hazard', title: 'hazard' });
    const wrong = await marks.add(goalId, { kind: 'dead_end', title: 'wrong' });
    const retired = await marks.add(goalId, { kind: 'tool', title: 'retired' });
    await marks.judge(goalId, trusted.id, 'confirms', { nodeId });
    await marks.judge(goalId, wrong.id, 'refutes', { nodeId });
    await marks.retire(goalId, retired.id, 'replaced');

    const ranked = activeMarks(await service.graph(goalId)).map((mark) => mark.id);

    // `wrong` sits at 1/3 — still above the floor after a single refutation.
    expect(ranked).toEqual([hazard.id, trusted.id, plain.id, wrong.id]);
  });

  it('caps the marks a prompt lists and says how many it left out', async () => {
    const { goalId, service } = await goalWithRun('op_mark_cap');
    const marks = new GoalMarkService(serverDB, userId);
    for (let i = 0; i < MARKS_IN_PROMPT + 2; i++)
      await marks.add(goalId, { kind: 'pattern', title: `pattern ${i}` });

    const prompt = marksForPrompt(await service.graph(goalId));

    expect(prompt.marks).toHaveLength(MARKS_IN_PROMPT);
    expect(prompt.omitted).toBe(2);
  });

  it('still records the outcome of a Task that left a mark while it ran', async () => {
    // A mark hangs off its Task by `produces`, the same edge an outcome finding
    // uses; settling must not read the mark as the finding already written.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Migrate a slice'], title: 'Outcome after mark' });
    const { nodeId, taskId } = await service.tick(graph.goal.id);
    await serverDB.insert(topics).values({ id: 'tpc_outcome', userId });
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Slice migrated', title: 'Slice migrated' },
      operationId: 'op_outcome',
      seq: 1,
      status: 'completed',
      taskId: taskId!,
      topicId: 'tpc_outcome',
      userId,
    });
    await new GoalMarkService(serverDB, userId).add(
      graph.goal.id,
      { kind: 'pattern', title: 'mock internal_ actions' },
      { nodeId: nodeId! },
    );
    await new TaskModel(serverDB, userId).updateStatus(taskId!, 'completed');

    await service.tick(graph.goal.id);

    const after = await service.graph(graph.goal.id);
    expect(after.nodes.find((node) => node.kind === 'finding')).toMatchObject({
      title: 'Slice migrated',
    });
  });
});
