// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { MetricModel } from '@/database/models/metric';
import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from '../../../taskRunner';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import type { GoalTickObservation } from '../../traceObservation';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  it('parks a goal short of acceptance and reopens it when the measurement clears', async () => {
    // The measured half of acceptance: "followers >= 1000" is not a document a
    // verifier reads, it is a number. Until it holds, the acceptance Task must
    // not be created — and the goal must not sit `running` reporting
    // `no_progress`, or every sweep would re-tick it for the whole wait.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const graph = await service.create({
      config: { acceptance: { metrics: [{ key: 'followers', target: 1000 }] } },
      requirement: 'Grow the account',
      tasks: ['Publish the first posts'],
      title: 'Measured goal',
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'completed');
    await service.tick(graph.goal.id);

    // Nothing measured yet — "never observed" is not "satisfied".
    const unmeasured = await service.tick(graph.goal.id);
    expect(unmeasured).toMatchObject({ outcome: 'no_progress' });
    expect(unmeasured.message).toContain('no observation');
    expect((await goalModel.findById(graph.goal.id))?.status).toBe('paused');
    expect(
      (await service.graph(graph.goal.id)).nodes.some(
        (n) => n.title === 'Complete full Goal acceptance',
      ),
    ).toBe(false);

    // A sample that is still short leaves it parked and is not worth an advance.
    const short = await service.recordObservation(graph.goal.id, {
      key: 'followers',
      value: 400,
    });
    expect(short.shouldAdvance).toBe(false);
    expect((await goalModel.findById(graph.goal.id))?.status).toBe('paused');

    // The number lands: the goal reopens and falls through to its delivery
    // contract.
    const cleared = await service.recordObservation(graph.goal.id, {
      key: 'followers',
      value: 1200,
    });
    expect(cleared.shouldAdvance).toBe(true);
    expect((await goalModel.findById(graph.goal.id))?.status).toBe('running');

    const advanced = await service.tick(graph.goal.id);
    expect(advanced).toMatchObject({ outcome: 'advanced' });
    expect(
      (await service.graph(graph.goal.id)).nodes.some(
        (n) => n.title === 'Complete full Goal acceptance',
      ),
    ).toBe(true);
  });

  /** A goal parked by the gate, one clause short of acceptance. */
  const parkedOnGate = async (service: GoalService) => {
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { acceptance: { metrics: [{ key: 'followers', target: 1000 }] } },
      requirement: 'Grow the account',
      tasks: ['Publish the first posts'],
      title: 'Parked on a measurement',
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'completed');
    await service.tick(graph.goal.id);
    await service.tick(graph.goal.id);
    return graph.goal.id;
  };

  it('reopens a goal parked before the pause marker existed', async () => {
    // Rows parked by the parent implementation — and any parked by an old
    // worker mid-deploy — carry no marker. Requiring one strictly would strand
    // them until somebody pressed Resume by hand, so the transition's recorded
    // actor stands in for it.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const goalId = await parkedOnGate(service);

    // Exactly what a pre-marker row looks like.
    const parked = (await goalModel.findById(goalId))!;
    await goalModel.update(goalId, { config: { ...parked.config, pausedBy: undefined } });

    const cleared = await service.recordObservation(goalId, { key: 'followers', value: 5000 });

    expect(cleared.shouldAdvance).toBe(true);
    expect((await goalModel.findById(goalId))?.status).toBe('running');
  });

  it('does not let an observation restart a goal the coordinator parked for another reason', async () => {
    // The coordinator also parks goals that are deadlocked or out of budget.
    // Those carry no marker either once they predate it, so the fallback has to
    // read *why* it parked — not just that it was the coordinator.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const graph = await service.create({
      config: { acceptance: { metrics: [{ key: 'followers', target: 1000 }] } },
      requirement: 'Deadlocked before the gate',
      tasks: ['A', 'B'],
      title: 'Parked with work outstanding',
    });
    const [a, b] = graph.nodes.filter((n) => n.kind === 'task');
    const graphModel = new GoalGraphModel(serverDB, userId);
    await graphModel.createEdge(graph.goal.id, a.id, b.id, 'depends_on');
    await graphModel.createEdge(graph.goal.id, b.id, a.id, 'depends_on');

    await service.tick(graph.goal.id); // deadlock → no_frontier → paused
    expect((await goalModel.findById(graph.goal.id))?.status).toBe('paused');

    const satisfying = await service.recordObservation(graph.goal.id, {
      key: 'followers',
      value: 5000,
    });

    expect(satisfying.shouldAdvance).toBe(false);
    expect((await goalModel.findById(graph.goal.id))?.status).toBe('paused');
  });

  it('leaves a deliberately paused goal alone even when the measurement lands', async () => {
    // The hard case: same status, same terminal phase, same clauses as a goal
    // the coordinator parked. Only the recorded pause reason tells them apart,
    // and without it a satisfying sample would restart a goal somebody stopped
    // on purpose — and run its acceptance work.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const goalId = await parkedOnGate(service);
    await service.pause(goalId);

    const satisfying = await service.recordObservation(goalId, { key: 'followers', value: 5000 });

    expect(satisfying.shouldAdvance).toBe(false);
    expect((await goalModel.findById(goalId))?.status).toBe('paused');
    expect(
      (await service.graph(goalId)).nodes.some((n) => n.title === 'Complete full Goal acceptance'),
    ).toBe(false);
  });

  it('resumes a user-paused goal only through resume, and then it advances again', async () => {
    // The other half: once the person lifts their own pause, the goal is the
    // coordinator's again.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const goalId = await parkedOnGate(service);
    await service.pause(goalId);
    await service.recordObservation(goalId, { key: 'followers', value: 5000 });

    await service.resume(goalId);

    expect(await service.tick(goalId)).toMatchObject({ outcome: 'advanced' });
  });

  it('unblocks a parked goal when its last clause is dropped', async () => {
    // `setMetricCriteria(id, [])` is the advertised way to clear the gate. It
    // used to leave the goal parked on a gate that no longer existed, so the
    // scheduled advance ticked straight back out as `goal_paused` and only a
    // manual resume could move it.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const goalId = await parkedOnGate(service);
    expect((await goalModel.findById(goalId))?.status).toBe('paused');

    await service.setMetricCriteria(goalId, []);

    expect((await goalModel.findById(goalId))?.status).toBe('running');
    expect(await service.tick(goalId)).toMatchObject({ outcome: 'advanced' });
  });

  it('unblocks a parked goal when a clause is relaxed below the measurement', async () => {
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const goalId = await parkedOnGate(service);
    await service.recordObservation(goalId, { key: 'followers', value: 400 });
    expect((await goalModel.findById(goalId))?.status).toBe('paused');

    await service.setMetricCriteria(goalId, [{ key: 'followers', target: 100 }]);

    expect((await goalModel.findById(goalId))?.status).toBe('running');
  });

  it('keeps the numeric gate when the delivery criteria are bound or rebound', async () => {
    // Both writers used to rebuild `config.acceptance` from `criteriaIds`
    // alone, so declaring criteria — at creation or later from the goal page —
    // silently dropped a live measured gate and let the goal be accepted
    // without it.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { acceptance: { metrics: [{ key: 'followers', target: 1000 }] } },
      criteria: [{ title: 'Ship the launch post' }],
      requirement: 'Grow the account',
      tasks: ['Publish the first posts'],
      title: 'Both halves of acceptance',
    });

    const created = await new GoalModel(serverDB, userId).findById(graph.goal.id);
    expect(created?.config?.acceptance?.metrics).toEqual([{ key: 'followers', target: 1000 }]);
    expect(created?.config?.acceptance?.criteriaIds).toHaveLength(1);

    await service.setAcceptanceCriteria(graph.goal.id, []);

    const rebound = await new GoalModel(serverDB, userId).findById(graph.goal.id);
    expect(rebound?.config?.acceptance?.metrics).toEqual([{ key: 'followers', target: 1000 }]);
  });

  it('merges a declared clause into the server-side list instead of replacing it', async () => {
    // Two editors declaring from the same stale snapshot must not erase each
    // other: merge upserts by key against the list as it stands on the server.
    const service = new GoalService(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const graph = await service.create({
      config: { acceptance: { metrics: [{ key: 'followers', target: 1000 }] } },
      requirement: 'Grow the account',
      tasks: ['Publish'],
      title: 'Merge-mode goal',
    });

    // A "concurrent" declaration this client never saw.
    await service.setMetricCriteria(
      graph.goal.id,
      [{ key: 'retention', op: 'gte', target: 80 }],
      'merge',
    );
    // This client merges its own clause from a snapshot that predates it.
    await service.setMetricCriteria(
      graph.goal.id,
      [{ key: 'followers', target: 2000, title: '粉丝' }],
      'merge',
    );

    const metrics = (await goalModel.findById(graph.goal.id))?.config?.acceptance?.metrics;
    expect(metrics).toHaveLength(2);
    expect(metrics).toContainEqual({ key: 'retention', op: 'gte', target: 80 });
    // Same-key merge upserts rather than duplicating.
    expect(metrics).toContainEqual({ key: 'followers', target: 2000, title: '粉丝' });
  });

  it('declares numeric clauses after creation without touching the criteria binding', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      criteria: [{ title: 'Ship the launch post' }],
      requirement: 'Grow the account',
      tasks: ['Publish the first posts'],
      title: 'Late-declared gate',
    });

    await service.setMetricCriteria(graph.goal.id, [{ key: 'churn', op: 'lte', target: 5 }]);

    const updated = await new GoalModel(serverDB, userId).findById(graph.goal.id);
    expect(updated?.config?.acceptance).toMatchObject({
      criteriaIds: expect.any(Array),
      metrics: [{ key: 'churn', op: 'lte', target: 5 }],
    });
    expect(updated?.config?.acceptance?.criteriaIds).toHaveLength(1);
  });

  it('records what the measured decision read, not just its verdict', async () => {
    // A replay has to see the number the live run saw — the same reason the
    // deadline verdict travels with the budget.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const metricModel = new MetricModel(serverDB, userId);
    const graph = await service.create({
      config: { acceptance: { metrics: [{ key: 'churn', op: 'lte', target: 5 }] } },
      requirement: 'Keep churn down',
      tasks: ['Ship retention fixes'],
      title: 'Traced measurement',
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'completed');
    await service.tick(graph.goal.id);

    const series = (await metricModel.ensure({
      key: 'churn',
      subjectId: graph.goal.id,
      subjectType: 'goal',
    }))!;
    await metricModel.addPoint(series.id, {
      actorType: 'system',
      observedAt: new Date('2026-09-01T00:00:00Z'),
      sourceType: 'probe',
      value: 9,
    });

    const observed: GoalTickObservation[] = [];
    await service.tick(graph.goal.id, { onDecision: (o) => observed.push(o) });

    expect(observed.at(-1)!.metricCriteria).toMatchObject({
      allMet: false,
      criteria: [{ key: 'churn', met: false, op: 'lte', target: 5, value: 9 }],
    });
  });

  it('reports each clause with the value the gate reads, before the terminal phase', async () => {
    // The graph carries only declarations: without this read a planning Agent
    // could not tell an unmeasured clause from one a person already recorded.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: {
        acceptance: {
          metrics: [
            { key: 'latency_ms', op: 'lte', target: 16.7, title: 'Input latency' },
            { key: 'accuracy', target: 99 },
          ],
        },
      },
      tasks: ['Measure'],
      title: 'Metric state',
    });
    await service.recordObservation(graph.goal.id, { key: 'latency_ms', value: 5 });

    expect(await service.metricState(graph.goal.id)).toMatchObject({
      allMet: false,
      criteria: [
        { key: 'latency_ms', met: true, title: 'Input latency', value: 5 },
        { key: 'accuracy', met: false, value: null },
      ],
    });
  });

  it('removes a clause by key and reopens a goal it alone was parking', async () => {
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const goalId = await parkedOnGate(service);
    await service.setMetricCriteria(goalId, [{ key: 'churn', op: 'lte', target: 5 }], 'merge');

    await service.removeMetricCriteria(goalId, ['followers']);
    const kept = await goalModel.findById(goalId);
    expect(kept?.config?.acceptance?.metrics).toEqual([{ key: 'churn', op: 'lte', target: 5 }]);
    expect(kept?.status).toBe('paused');

    await service.removeMetricCriteria(goalId, ['churn']);
    const cleared = await goalModel.findById(goalId);
    expect(cleared?.config?.acceptance?.metrics).toBeUndefined();
    expect(cleared?.status).toBe('running');
  });

  it('applies concurrent clause edits one after the other', async () => {
    // Both edits read the list before either wrote it: one removing "followers"
    // and one declaring "churn" must end as just "churn", never resurrecting
    // the removed clause or losing the new one.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { acceptance: { metrics: [{ key: 'followers', target: 1000 }] } },
      tasks: ['Grow'],
      title: 'Concurrent clause edits',
    });

    await Promise.all([
      service.removeMetricCriteria(graph.goal.id, ['followers']),
      service.setMetricCriteria(graph.goal.id, [{ key: 'churn', op: 'lte', target: 5 }], 'merge'),
    ]);

    const goal = await new GoalModel(serverDB, userId).findById(graph.goal.id);
    expect(goal?.config?.acceptance?.metrics).toEqual([{ key: 'churn', op: 'lte', target: 5 }]);
  });
});
