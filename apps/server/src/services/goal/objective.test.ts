// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalGraphModel } from '@/database/models/goalGraph';
import type { LobeChatDatabase } from '@/database/type';

import { GoalService } from './GoalService';
import { buildLeaderboard, GoalObjectiveService, MANUAL_LANE } from './objective';
import { registerGoalServiceTestCleanup } from './testUtils';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-objective-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

const objective = { direction: 'max' as const, evaluator: 'python score.py' };

/** A goal with two Task nodes, the second inside an experiment container. */
const goalWithLanes = async () => {
  const service = new GoalService(serverDB, userId);
  const graph = await service.create({ tasks: ['Lane A'], title: 'Objective goal' });
  const graphModel = new GoalGraphModel(serverDB, userId);
  const problem = graph.nodes.find((node) => node.kind === 'problem')!;
  const laneA = graph.nodes.find((node) => node.kind === 'task')!;
  const container = await graphModel.createNode(graph.goal.id, {
    kind: 'experiment',
    questionId: problem.id,
    title: 'Lane B',
  });
  const laneBTask = await graphModel.createNode(graph.goal.id, {
    kind: 'task',
    scopeId: container!.id,
    title: 'Work in lane B',
  });
  return { container: container!, goalId: graph.goal.id, laneA, laneBTask: laneBTask! };
};

describe('buildLeaderboard', () => {
  const point = (lane: string | undefined, value: number, minute: number) => ({
    metadata: lane ? { lane } : null,
    observedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
    value,
  });

  it('ranks lanes by their best score and keeps each lane latest result', () => {
    const board = buildLeaderboard(objective, [
      point('a', 10, 1),
      point('b', 12, 2),
      point('a', 15, 3),
      point('a', 11, 4),
      point(undefined, 3, 5),
    ]);

    expect(
      board.lanes.map((lane) => [lane.lane, lane.best, lane.latest, lane.evaluations]),
    ).toEqual([
      ['a', 15, 11, 3],
      ['b', 12, 12, 1],
      [MANUAL_LANE, 3, 3, 1],
    ]);
    expect(board).toMatchObject({ best: 15, leader: 'a' });
    expect(board.bestAt).toBe(new Date(Date.UTC(2026, 0, 1, 0, 3)).toISOString());
  });

  it('follows a minimising objective', () => {
    const board = buildLeaderboard({ ...objective, direction: 'min' }, [
      point('a', 10, 1),
      point('b', 4, 2),
      point('a', 6, 3),
    ]);

    expect(board.lanes.map((lane) => [lane.lane, lane.best])).toEqual([
      ['b', 4],
      ['a', 6],
    ]);
    expect(board.best).toBe(4);
  });
});

describe('GoalObjectiveService', () => {
  it('refuses an evaluation before the goal has an objective', async () => {
    const { goalId, laneA } = await goalWithLanes();

    await expect(
      new GoalObjectiveService(serverDB, userId).recordEvaluation(
        goalId,
        { score: 1, valid: true },
        { nodeId: laneA.id, taskId: 'task_x' },
      ),
    ).rejects.toThrow(/no objective/);
  });

  it('records each run in its lane — the experiment container, else the Task node', async () => {
    const { container, goalId, laneA, laneBTask } = await goalWithLanes();
    const service = new GoalObjectiveService(serverDB, userId);
    await service.setObjective(goalId, { ...objective, title: 'Judge score' });

    const first = await service.recordEvaluation(
      goalId,
      { fingerprint: 'abc', score: 20, valid: true },
      { nodeId: laneA.id, taskId: 'task_a' },
    );
    expect(first).toMatchObject({
      lane: laneA.id,
      newBest: true,
      newLaneBest: true,
      recorded: true,
    });

    const second = await service.recordEvaluation(
      goalId,
      { score: 25, valid: true },
      { nodeId: laneBTask.id, taskId: 'task_b' },
    );
    expect(second).toMatchObject({ lane: container.id, newBest: true });

    const third = await service.recordEvaluation(
      goalId,
      { score: 22, valid: true },
      { nodeId: laneA.id, taskId: 'task_a' },
    );
    expect(third).toMatchObject({ newBest: false, newLaneBest: true });

    const board = await service.leaderboard(goalId, laneBTask.id);
    expect(board?.lanes.map((lane) => [lane.title, lane.best, lane.latest])).toEqual([
      ['Lane B', 25, 25],
      ['Lane A', 22, 22],
    ]);
    expect(board).toMatchObject({
      best: 25,
      key: 'objective',
      leader: container.id,
      you: container.id,
    });
  });

  it('reports an invalid evaluation without charting it', async () => {
    const { goalId, laneA } = await goalWithLanes();
    const service = new GoalObjectiveService(serverDB, userId);
    await service.setObjective(goalId, objective);

    const result = await service.recordEvaluation(
      goalId,
      { score: 0, summary: 'crashed', valid: false },
      { nodeId: laneA.id, taskId: 'task_a' },
    );

    expect(result.recorded).toBe(false);
    expect((await service.leaderboard(goalId))?.lanes).toEqual([]);
  });

  it('puts an evaluation a person records in the manual lane, and clears the objective', async () => {
    const { goalId } = await goalWithLanes();
    const service = new GoalObjectiveService(serverDB, userId);
    await service.setObjective(goalId, objective);

    expect(await service.recordEvaluation(goalId, { score: 5, valid: true })).toMatchObject({
      lane: MANUAL_LANE,
    });

    await service.setObjective(goalId, null);
    expect(await service.leaderboard(goalId)).toBeUndefined();
  });

  it('rejects an objective without an evaluator', async () => {
    const { goalId } = await goalWithLanes();

    await expect(
      new GoalObjectiveService(serverDB, userId).setObjective(goalId, {
        ...objective,
        evaluator: ' ',
      }),
    ).rejects.toThrow(/evaluator/);
  });
});
