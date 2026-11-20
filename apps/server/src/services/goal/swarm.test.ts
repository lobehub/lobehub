// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { GoalRepository } from '@/database/repositories/goal';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from '../taskRunner';
import { GoalService } from './GoalService';
import { isClosedSwarmLane } from './GoalService/swarm';
import { GoalObjectiveService } from './objective';
import * as scheduler from './scheduler';
import { GoalSwarmService, SWARM_LANE_ATTEMPTS } from './swarm';
import { registerGoalServiceTestCleanup } from './testUtils';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-swarm-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

const inTwoHours = () => new Date(Date.now() + 2 * 3_600_000).toISOString();

const createSwarm = (overrides: Partial<Parameters<GoalSwarmService['create']>[0]> = {}) =>
  new GoalSwarmService(serverDB, userId).create({
    deadline: inTwoHours(),
    lanes: 3,
    objective: { direction: 'max', evaluator: './score.sh', title: 'Judge score' },
    title: 'Raise the score',
    workspace: '/work/k12/',
    ...overrides,
  });

/** Move the deadline into the past without waiting for it. */
const expireDeadline = async (goalId: string) => {
  const repository = new GoalRepository(serverDB, userId);
  const goal = await repository.findById(goalId);
  await repository.update(goalId, {
    config: { ...goal!.config, schedule: { deadline: new Date(Date.now() - 1000).toISOString() } },
  });
};

describe('GoalSwarmService.create', () => {
  let schedule: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    schedule = vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  });
  afterEach(() => vi.restoreAllMocks());

  it('starts a goal with one experiment container and Task per lane, and a wake at the deadline', async () => {
    const graph = await createSwarm();
    const swarm = graph.goal.config?.swarm;

    expect(graph.goal.status).toBe('running');
    expect(swarm?.workspace).toBe('/work/k12');
    expect(swarm?.lanes.map((lane) => lane.key)).toEqual(['A', 'B', 'C']);
    for (const lane of swarm!.lanes) {
      const container = graph.nodes.find((node) => node.id === lane.containerId);
      expect(container).toMatchObject({ kind: 'experiment', title: `Lane ${lane.key}` });
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          kind: 'contains',
          sourceNodeId: lane.containerId,
          targetNodeId: lane.taskNodeId,
        }),
      );
    }
    expect(graph.goal.config).toMatchObject({
      maxConcurrentTasks: 3,
      objective: { direction: 'max', evaluator: './score.sh' },
      recovery: { maxAttemptsPerTask: SWARM_LANE_ATTEMPTS },
    });
    const wake = schedule.mock.calls.find(([params]) => params.trigger === 'budget')?.[0];
    expect(wake?.delay).toBeGreaterThan(7000);
  });

  it.each([
    [{ workspace: 'relative/dir' }, /absolute path/],
    [{ deadline: new Date(Date.now() - 60_000).toISOString() }, /future/],
    [{ lanes: 9 }, /1–8 lanes/],
  ])('refuses %o', async (overrides, message) => {
    await expect(createSwarm(overrides)).rejects.toThrow(message);
  });
});

describe('a running swarm', () => {
  beforeEach(() => {
    vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  });
  afterEach(() => vi.restoreAllMocks());

  it('gives each lane Task its own directory, no acceptance, and the lane contract', async () => {
    const graph = await createSwarm({ lanes: 1 });
    const result = await new GoalService(serverDB, userId).tick(graph.goal.id);
    const task = await new TaskModel(serverDB, userId).findById(result.taskId!);

    expect(task?.config).toMatchObject({ execution: { workingDirectory: '/work/k12/.lanes/A' } });
    expect(task?.instruction).toContain('You are lane A of a swarm');
    expect(task?.instruction).not.toContain('This Task carries its own Acceptance');
    const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject('task', task!.id);
    expect(acceptance?.config).toMatchObject({ enabled: false });
  });

  it('starts a finished lane again before the deadline instead of resolving it', async () => {
    const run = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const graph = await createSwarm({ lanes: 1 });
    const service = new GoalService(serverDB, userId);
    const { taskId } = await service.tick(graph.goal.id);
    const tasks = new TaskModel(serverDB, userId);
    await tasks.updateStatus(taskId!, 'completed');
    await tasks.update(taskId!, { totalTopics: 1 });

    await service.tick(graph.goal.id);

    const lane = (await service.graph(graph.goal.id)).nodes.find(
      (node) => node.id === graph.goal.config!.swarm!.lanes[0].taskNodeId,
    );
    expect(lane?.status).not.toBe('resolved');
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ extraPrompt: expect.stringContaining('Lane A continues'), taskId }),
    );
    expect((await tasks.findById(taskId!))?.status).toBe('running');
  });

  it('at the deadline stops the lanes, promotes the leader, then achieves the goal', async () => {
    const graph = await createSwarm({ lanes: 2 });
    const goalId = graph.goal.id;
    const [laneA, laneB] = graph.goal.config!.swarm!.lanes;
    const objective = new GoalObjectiveService(serverDB, userId);
    await objective.recordEvaluation(
      goalId,
      { score: 30, valid: true },
      { nodeId: laneA.taskNodeId, taskId: 't_a' },
    );
    await objective.recordEvaluation(
      goalId,
      { score: 41, valid: true },
      { nodeId: laneB.taskNodeId, taskId: 't_b' },
    );
    await expireDeadline(goalId);
    const service = new GoalService(serverDB, userId);

    const wrap = await service.tick(goalId);

    expect(wrap.message).toContain('promoting lane B (score 41)');
    let after = await service.graph(goalId);
    expect(after.goal.config?.schedule?.deadline).toBeNull();
    expect(after.goal.config?.swarm?.wrapUp).toMatchObject({
      championLane: 'B',
      championScore: 41,
    });
    for (const lane of [laneA, laneB])
      expect(after.nodes.find((node) => node.id === lane.taskNodeId)?.status).toBe('resolved');
    const promoteId = after.goal.config!.swarm!.wrapUp!.promoteNodeId!;
    expect(after.nodes.find((node) => node.id === promoteId)).toMatchObject({
      kind: 'task',
      title: 'Promote lane B (score 41)',
    });

    // The promotion Task runs in the workspace itself, without an acceptance.
    const created = await service.tick(goalId);
    const promoteTask = await new TaskModel(serverDB, userId).findById(created.taskId!);
    expect(promoteTask?.config).toMatchObject({ execution: { workingDirectory: '/work/k12' } });
    expect(promoteTask?.instruction).toContain('lh goal lane promote B');

    await new GoalGraphModel(serverDB, userId).updateNodeStatus(goalId, promoteId, 'resolved');
    const done = await service.tick(goalId);
    after = await service.graph(goalId);
    expect(done.outcome).toBe('achieved');
    expect(after.goal.status).toBe('achieved');
    expect(after.nodes.some((node) => node.title === 'Complete full Goal acceptance')).toBe(false);
  });

  it('leaves a freshly claimed wrap-up to the advance that claimed it', async () => {
    const graph = await createSwarm({ lanes: 1 });
    const goalId = graph.goal.id;
    const [laneA] = graph.goal.config!.swarm!.lanes;
    await new GoalObjectiveService(serverDB, userId).recordEvaluation(
      goalId,
      { score: 17, valid: true },
      { nodeId: laneA.taskNodeId, taskId: 't_a' },
    );
    // What a concurrent advance writes when it takes the claim: champion known,
    // the promotion Task not queued yet.
    const repository = new GoalRepository(serverDB, userId);
    const goal = await repository.findById(goalId);
    await repository.update(goalId, {
      config: {
        ...goal!.config,
        schedule: { ...goal!.config.schedule, deadline: null },
        swarm: {
          ...goal!.config.swarm!,
          wrapUp: { championLane: 'A', championScore: 17, startedAt: new Date().toISOString() },
        },
      },
    });
    const service = new GoalService(serverDB, userId);

    // Waiting, not idle: the claiming advance already resolved the lanes, so a
    // tick that fell through to the coordinator would pause the goal.
    const waiting = await service.tick(goalId);
    expect(waiting.outcome).toBe('waiting_external');

    const after = await service.graph(goalId);
    expect(after.nodes.filter((node) => node.title.startsWith('Promote lane'))).toHaveLength(0);
    expect(after.goal.status).toBe('running');
  });

  it('rebuilds the promotion Task when the advance that claimed the wrap-up died', async () => {
    const graph = await createSwarm({ lanes: 1 });
    const goalId = graph.goal.id;
    const [laneA] = graph.goal.config!.swarm!.lanes;
    await new GoalObjectiveService(serverDB, userId).recordEvaluation(
      goalId,
      { score: 17, valid: true },
      { nodeId: laneA.taskNodeId, taskId: 't_a' },
    );
    const repository = new GoalRepository(serverDB, userId);
    const goal = await repository.findById(goalId);
    await repository.update(goalId, {
      config: {
        ...goal!.config,
        schedule: { ...goal!.config.schedule, deadline: null },
        swarm: {
          ...goal!.config.swarm!,
          wrapUp: {
            championLane: 'A',
            championScore: 17,
            startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
          },
        },
      },
    });
    const service = new GoalService(serverDB, userId);

    const resumed = await service.tick(goalId);

    expect(resumed.message).toContain('promoting lane A (score 17)');
    const after = await service.graph(goalId);
    const promotes = after.nodes.filter((node) => node.title.startsWith('Promote lane'));
    expect(promotes).toHaveLength(1);
    expect(after.goal.config!.swarm!.wrapUp).toMatchObject({
      championLane: 'A',
      promoteNodeId: promotes[0].id,
    });
  });

  it('ends without a promotion when no lane recorded a valid score', async () => {
    const graph = await createSwarm({ lanes: 1 });
    await expireDeadline(graph.goal.id);
    const service = new GoalService(serverDB, userId);

    expect((await service.tick(graph.goal.id)).message).toContain('no lane recorded a valid score');
    expect((await service.tick(graph.goal.id)).outcome).toBe('achieved');
  });
});

describe('isClosedSwarmLane', () => {
  it('closes a real swarm lane after a wrap-up is claimed', async () => {
    vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
    const graph = await createSwarm({ lanes: 1 });
    const laneNodeId = graph.goal.config!.swarm!.lanes[0].taskNodeId;
    expect(isClosedSwarmLane(graph, laneNodeId)).toBe(false);

    const repository = new GoalRepository(serverDB, userId);
    await repository.update(graph.goal.id, {
      config: {
        ...graph.goal.config,
        swarm: {
          ...graph.goal.config!.swarm!,
          wrapUp: { championLane: 'A', championScore: 12, startedAt: new Date().toISOString() },
        },
      },
    });

    const after = await new GoalService(serverDB, userId).graph(graph.goal.id);
    expect(isClosedSwarmLane(after, laneNodeId)).toBe(true);
    vi.restoreAllMocks();
  });
});
