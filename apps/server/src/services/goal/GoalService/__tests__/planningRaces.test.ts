// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { goals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { GoalCriteriaGeneratorService } from '../../criteriaGenerator';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  it('plans the decomposition once when two advances race through the planner', async () => {
    // The queued kickoff and the client's fire-and-forget fallback can both
    // reach plan_decomposition together; the atomic planning claim must stop
    // the loser BEFORE the planner call, so nothing double-plans or double-pays.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let plannerCalls = 0;
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockImplementation(async () => {
      plannerCalls += 1;
      await gate;
      return {
        problemStatement: '并发规划',
        tasks: [
          { dependsOn: [], instruction: '收集', title: '方向A' },
          { dependsOn: [0], instruction: '分析', title: '方向B' },
        ],
      };
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ problemDescription: '原话', title: 'Raced planning' });

    const ticks = Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);
    // The winner holds the planner open; the loser must lose the claim and
    // return without ever entering it.
    await vi.waitFor(() => expect(plannerCalls).toBe(1));
    release();
    const results = await ticks;

    expect(plannerCalls).toBe(1);
    expect(results.filter((r) => r.outcome === 'advanced')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'waiting_external')).toHaveLength(1);
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(2);
    expect(after.edges.filter((e) => e.kind === 'depends_on')).toHaveLength(1);
  });

  it('keeps the plan when the goal is renamed while the planner runs', async () => {
    // Creating a goal without a drafted title names it in the background, right
    // as its first plan is being made; that rename must not throw the plan away.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const planner = vi
      .spyOn(GoalCriteriaGeneratorService.prototype, 'decompose')
      .mockImplementation(async () => {
        await gate;
        return {
          problemStatement: '改名不影响规划',
          tasks: [{ dependsOn: [], instruction: '收集', title: '方向A' }],
        };
      });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ problemDescription: '原话', title: 'Stopgap' });

    const tick = service.tick(graph.goal.id);
    await vi.waitFor(() => expect(planner).toHaveBeenCalled());
    await service.updateTitle(graph.goal.id, 'Named');
    release();
    await tick;

    const after = await service.graph(graph.goal.id);
    expect(after.goal.title).toBe('Named');
    expect(after.nodes.filter((node) => node.kind === 'task')).toHaveLength(1);
  });

  it('waits for an unfenced legacy planner instead of generating a second graph', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Legacy in-flight planning' });
    // The pre-lease binary claimed only the status, without a checkpoint.
    await serverDB.update(goals).set({ status: 'running' }).where(eq(goals.id, graph.goal.id));
    const planner = vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose');

    expect((await service.tick(graph.goal.id)).outcome).toBe('waiting_external');
    expect(planner).not.toHaveBeenCalled();
    expect(
      (await service.graph(graph.goal.id)).nodes.filter((node) => node.kind === 'task'),
    ).toHaveLength(0);
  });

  it('does not call the planner again when a late advance sees running with no tasks', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const planner = vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose');
    planner.mockImplementationOnce(async () => {
      await gate;
      return {
        problemStatement: 'First plan',
        tasks: [{ instruction: 'Collect sources', title: 'Original research' }],
      };
    });
    planner.mockResolvedValue({
      problemStatement: 'Second plan',
      tasks: [{ instruction: 'Collect sources', title: 'Equivalent research' }],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Staggered planning' });
    const first = service.tick(graph.goal.id);
    try {
      await vi.waitFor(() => expect(planner).toHaveBeenCalledTimes(1));
      // The initial claim already changed the status, but has not produced any tasks.
      expect((await service.graph(graph.goal.id)).goal.status).toBe('running');
      const late = await new GoalService(serverDB, userId).tick(graph.goal.id);
      expect(late.outcome).toBe('waiting_external');
      expect(planner).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await first;
    }
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((node) => node.kind === 'task')).toHaveLength(1);
    expect(after.nodes.filter((node) => node.kind === 'experiment')).toHaveLength(0);
    expect(after.nodes.find((node) => node.kind === 'problem')?.description).toBe('First plan');
    expect(after.edges.filter((edge) => edge.kind === 'decomposes')).toHaveLength(1);
  });

  it('rejects a late planner after an expired lease is taken over', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const planner = vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose');
    planner.mockImplementationOnce(async () => {
      await gate;
      return { problemStatement: 'Stale plan', tasks: [{ instruction: 'Old', title: 'Old task' }] };
    });
    planner.mockResolvedValue({
      problemStatement: 'Recovered plan',
      tasks: [{ instruction: 'New', title: 'New task' }],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Lease recovery' });
    const first = service.tick(graph.goal.id);
    try {
      await vi.waitFor(() => expect(planner).toHaveBeenCalledTimes(1));
      const model = new GoalModel(serverDB, userId);
      const current = await model.findById(graph.goal.id);
      await serverDB
        .update(goals)
        .set({
          config: {
            ...current?.config,
            planningCheckpoint: {
              token: current!.config!.planningCheckpoint!.token,
              expiresAt: '2000-01-01T00:00:00.000Z',
            },
          },
        })
        .where(eq(goals.id, graph.goal.id));
      await new GoalService(serverDB, userId).tick(graph.goal.id);
    } finally {
      release();
      await first;
    }
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((node) => node.kind === 'task').map((node) => node.title)).toEqual([
      'New task',
    ]);
    expect(after.goal.config?.planningCheckpoint).toBeUndefined();
  });

  it.each(['paused', 'changed'] as const)(
    'discards planning when the goal is %s during generation',
    async (change) => {
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({ title: 'Original goal' });
      vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockImplementation(async () => {
        await new GoalModel(serverDB, userId).update(
          graph.goal.id,
          change === 'paused' ? { status: 'paused' } : { requirement: 'New requirement' },
        );
        return { problemStatement: 'Old plan', tasks: [{ instruction: 'Old', title: 'Old task' }] };
      });
      await service.tick(graph.goal.id);
      const after = await service.graph(graph.goal.id);
      expect(after.nodes.filter((node) => node.kind === 'task')).toHaveLength(0);
      expect(after.goal.config?.planningCheckpoint).toBeUndefined();
    },
  );

  it('rolls back an incomplete decomposition and allows a clean retry', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: 'Planned question',
      tasks: [
        { instruction: 'Collect sources', title: 'Research' },
        { dependsOn: [0], instruction: 'Write report', title: 'Report' },
      ],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      problemDescription: 'Original question',
      title: 'Atomic planning',
    });
    // Fail only when the planner reaches dependency insertion, after all nodes
    // and their ownership edges have been written.
    await serverDB.execute(
      sql`ALTER TABLE goal_edges ADD CONSTRAINT fail_planning_dependency CHECK (kind <> 'depends_on')`,
    );
    try {
      await expect(service.tick(graph.goal.id)).rejects.toThrow();
    } finally {
      await serverDB.execute(sql`ALTER TABLE goal_edges DROP CONSTRAINT fail_planning_dependency`);
    }
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
    expect(after.nodes[0].description).toBe('Original question');
    expect(after.edges).toHaveLength(0);
    expect(
      after.events.filter((event) => event.entityType === 'node' && event.eventType === 'created'),
    ).toHaveLength(1);

    await service.tick(graph.goal.id);
    const retried = await service.graph(graph.goal.id);
    expect(retried.nodes.filter((node) => node.kind === 'task')).toHaveLength(2);
    expect(retried.edges.filter((edge) => edge.kind === 'depends_on')).toHaveLength(1);
  });

  it('falls back to a single Task when the planner fails, instead of stalling', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockRejectedValue(
      new Error('model unavailable'),
    );
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ problemDescription: '原话', title: 'Nothing to do' });

    const result = await service.tick(graph.goal.id);

    expect(result.outcome).toBe('advanced');
    const tasks = (await service.graph(graph.goal.id)).nodes.filter((n) => n.kind === 'task');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe('原话');
  });

  it('parks a goal nothing can move so the sweep stops re-picking it', async () => {
    // Every remaining Task is blocked and nothing runs to unblock it. Left
    // `running` it is selected by every newest-first scan forever, and enough
    // of them starve every other stalled goal out of the sweep's window.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['A', 'B'], title: 'Deadlocked' });
    const [a, b] = graph.nodes.filter((n) => n.kind === 'task');
    const graphModel = new GoalGraphModel(serverDB, userId);
    await graphModel.createEdge(graph.goal.id, a.id, b.id, 'depends_on');
    await graphModel.createEdge(graph.goal.id, b.id, a.id, 'depends_on');

    const result = await service.tick(graph.goal.id);

    expect(result.outcome).toBe('no_progress');
    expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');
    expect(
      await GoalModel.listStalled(serverDB, { staleBefore: new Date(Date.now() - 60_000) }),
    ).not.toContainEqual(expect.objectContaining({ id: graph.goal.id }));
  });

  it('leaves goal-level status transitions on the event trail', async () => {
    // The coordinator parks and reopens goals constantly, but only node
    // transitions used to be recorded — `entity_type='goal'` events existed in
    // the schema with no writer, so the lifecycle timeline was unreconstructable.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['A', 'B'], title: 'Lifecycle trail' });
    const [a, b] = graph.nodes.filter((n) => n.kind === 'task');
    const graphModel = new GoalGraphModel(serverDB, userId);
    await graphModel.createEdge(graph.goal.id, a.id, b.id, 'depends_on');
    await graphModel.createEdge(graph.goal.id, b.id, a.id, 'depends_on');

    await service.tick(graph.goal.id); // deadlock → no_frontier → paused
    await service.resume(graph.goal.id); // paused → running

    const lifecycle = (await service.graph(graph.goal.id)).events.filter(
      (event) => event.entityType === 'goal',
    );

    // Same-millisecond events read back in either order; assert on content.
    expect(lifecycle).toHaveLength(2);
    expect(lifecycle).toContainEqual(
      expect.objectContaining({
        actorType: 'system',
        eventType: 'updated',
        reason: 'no eligible task to advance',
      }),
    );
    expect(lifecycle).toContainEqual(
      expect.objectContaining({ eventType: 'activated', reason: 'resumed by user' }),
    );
  });

  it('reopens a goal its deadline stopped when the deadline moves out', async () => {
    // A calendar deadline is the long-horizon budget unit; extending it has to
    // unstick the goal exactly like raising a round budget does. Two ticks:
    // creating the responsible task costs nothing, the deadline gates the run.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { schedule: { deadline: new Date(Date.now() - 1000).toISOString() } },
      title: 'Overdue',
      tasks: ['Too late to start'],
    });

    await service.tick(graph.goal.id); // creates the responsible task
    const stopped = await service.tick(graph.goal.id);
    expect(stopped.message).toContain('Deadline passed');
    expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');

    const extended = await service.setBudget(graph.goal.id, {
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(extended?.status).not.toBe('paused');
    expect(extended?.config?.schedule?.deadline).toBeTruthy();
  });

  it('dispatches a Task when the goal has no deadline', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Just task'], title: 'No deadline' });

    const result = await service.tick(graph.goal.id);

    expect(result.outcome).toBe('advanced');
  });
});
