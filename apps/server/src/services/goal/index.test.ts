// @vitest-environment node
import { GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { MetricModel } from '@/database/models/metric';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import {
  acceptances,
  agentOperations,
  agents,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goals,
  metricPoints,
  metrics,
  tasks,
  taskTopics,
  topics,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';

import { TaskService } from '../task';
import { TaskRunnerService } from '../taskRunner';
import { VerifyPlanGeneratorService } from '../verify/planGenerator';
import { GoalCriteriaGeneratorService } from './criteriaGenerator';
import { LEASE_EXPIRED_ERROR, VERIFICATION_FAILED_ERROR } from './decideNextMove';
import { GoalService } from './index';
import { VERIFY_SETTLE_GRACE_MS } from './recoveryPolicy';
import type { GoalTickObservation } from './traceObservation';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  vi.restoreAllMocks();
  // PGlite does not consistently order the nested user -> goal -> graph
  // cascades, so clear graph leaves explicitly before their owned roots.
  await serverDB.delete(goalNodeDecisions);
  await serverDB.delete(goalEdges);
  await serverDB.delete(goalEvents);
  await serverDB.delete(goalNodes);
  await serverDB.delete(goals);
  await serverDB.delete(metricPoints);
  await serverDB.delete(metrics);
  await serverDB.delete(acceptances);
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskTopics);
  await serverDB.delete(topics);
  await serverDB.delete(tasks);
  await serverDB.delete(agents);
  await serverDB.delete(users);
});

describe('GoalService', () => {
  it('persists structured criteria on create and records their ids on the goal config', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      criteria: [
        { description: 'Runs end to end locally', title: 'Local run works' },
        { instruction: 'Check README covers install and run', title: 'Docs are complete' },
      ],
      title: 'Structured goal',
      tasks: ['Only task'],
    });

    const criteriaIds = graph.goal.config?.acceptance?.criteriaIds ?? [];
    expect(criteriaIds).toHaveLength(2);

    const rows = await serverDB.query.verifyCriteria.findMany();
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(criteriaIds[0])?.title).toBe('Local run works');
    expect(byId.get(criteriaIds[1])?.title).toBe('Docs are complete');
    // the how-to-judge instruction landed in a linked document
    expect(byId.get(criteriaIds[1])?.documentId).toBeTruthy();
  });

  it('rebinding criteria also updates the dispatched terminal acceptance task', async () => {
    // Editing the standard after the terminal Goal-acceptance Task exists must
    // not leave that Task's Acceptance gating on the stale id list.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      criteria: [{ title: 'Original criterion' }],
      requirement: 'Deliver with evidence',
      title: 'Rebind criteria goal',
      tasks: ['Only task'],
    });

    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'completed');
    await service.tick(graph.goal.id); // synthesize finding
    await service.tick(graph.goal.id); // create acceptance task
    const acceptanceTaskCreated = await service.tick(graph.goal.id); // dispatch it
    expect(acceptanceTaskCreated.taskId).toBeDefined();

    const [replacementId] = await new VerifyPlanGeneratorService(
      serverDB,
      userId,
    ).createCriteriaFromDrafts([
      { onFail: 'manual', required: true, title: 'Replacement criterion', verifierType: 'agent' },
    ]);
    await service.setAcceptanceCriteria(graph.goal.id, [replacementId]);

    const goal = (await service.graph(graph.goal.id)).goal;
    expect(goal.config?.acceptance?.criteriaIds).toEqual([replacementId]);
    const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject(
      'task',
      acceptanceTaskCreated.taskId!,
    );
    expect(acceptance?.config?.verifyCriteriaIds).toEqual([replacementId]);
  });

  it('creates only one responsible task when ticks race on the same task node', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Single owner task'], title: 'Concurrent goal' });

    const results = await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);
    const current = await service.graph(graph.goal.id);
    const taskRows = await serverDB.select().from(tasks);

    expect(results.filter((result) => result.outcome === 'advanced')).toHaveLength(1);
    expect(taskRows).toHaveLength(1);
    expect(current.nodes.find((node) => node.kind === 'task')?.taskId).toBe(taskRows[0].id);
    expect(current.workVersions).toHaveLength(1);
  });

  it('starts the bound Task once when advances race on dispatch', async () => {
    // Overlapping advances (an event hook, a manual nudge, the sweep) both read
    // the task as backlog; without an atomic claim both would call runTask and
    // the user would pay for the same Task twice.
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockImplementation(async ({ taskId }) => ({ taskId }) as never);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Only run once'], title: 'Raced dispatch' });
    await service.tick(graph.goal.id);

    const results = await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.message.startsWith('Started task'))).toHaveLength(1);
  });

  it('retries a failed verification once when advances race on recovery', async () => {
    // The dispatch claim only covers starting a backlog Task; the automatic
    // retry path spawns its own run, so without the same claim two overlapping
    // advances would each pay for an attempt.
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockImplementation(async ({ taskId }) => ({ taskId }) as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 3 } },
      title: 'Raced recovery',
      tasks: ['Retry me once'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });
    runSpy.mockClear();

    await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it.each([LEASE_EXPIRED_ERROR, VERIFICATION_FAILED_ERROR])(
    'does not dispatch recovery for an overdue goal with %s',
    async (error) => {
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({} as never);
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const graph = await service.create({
        config: { schedule: { deadline: new Date(Date.now() - 1000).toISOString() } },
        title: `Overdue recovery ${error}`,
        tasks: ['Do not retry'],
      });
      const created = await service.tick(graph.goal.id);
      await taskModel.updateStatus(created.taskId!, 'paused', { error });
      runSpy.mockClear();

      const stopped = await service.tick(graph.goal.id);

      expect(runSpy).not.toHaveBeenCalled();
      expect(stopped).toMatchObject({ outcome: 'no_progress' });
      expect(stopped.message).toContain('Deadline passed');
    },
  );

  it('hands back a dispatch claim whose worker died before the run existed', async () => {
    // The claim is taken just before `runTask` creates the topic. If the worker
    // dies in that sliver the task is `running` with no operation to reclaim,
    // and every later advance would report `waiting_external` forever.
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockRejectedValue(new Error('worker died'));
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Start me'], title: 'Orphaned claim' });
    const created = await service.tick(graph.goal.id);

    // The claim survives the crash: put the row back where a dead worker left it.
    await expect(service.tick(graph.goal.id)).rejects.toThrow('worker died');
    await taskModel.updateStatus(created.taskId!, 'running');
    await serverDB
      .update(tasks)
      .set({ updatedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(tasks.id, created.taskId!));

    const released = await service.tick(graph.goal.id);

    expect(released.outcome).toBe('advanced');
    expect((await taskModel.findById(created.taskId!))?.status).toBe('backlog');
    runSpy.mockRestore();
  });

  it('does not re-dispatch a delivered Task while verification is still judging', async () => {
    // A verify-bound Task keeps its task `running` with a completed topic until
    // the verify run settles, and that judgment routinely outlives the
    // operation lease. Treating the window as a dead claim released the task
    // back to backlog, and the next advance paid for a ghost attempt that the
    // verify settle path then canceled.
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { operationLeaseTimeoutMs: 60_000 } },
      title: 'Deliveries wait for verification',
      tasks: ['Deliver and wait'],
    });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      operationId: 'op-delivered',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await taskModel.updateStatus(created.taskId!, 'running');
    await serverDB
      .update(tasks)
      .set({ updatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(tasks.id, created.taskId!));

    const waiting = await service.tick(graph.goal.id);

    expect(waiting).toMatchObject({
      message: expect.stringContaining('waiting for verification'),
      outcome: 'waiting_external',
      taskId: created.taskId,
    });
    expect((await taskModel.findById(created.taskId!))?.status).toBe('running');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('reclaims a delivered Task once the verification grace window lapses', async () => {
    // The hold-off above cannot be unconditional: a verify run that died
    // silently would otherwise strand the goal forever, which is exactly the
    // failure mode the sweep exists to break.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { operationLeaseTimeoutMs: 60_000 } },
      title: 'Dead verification is reclaimed',
      tasks: ['Deliver into silence'],
    });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      createdAt: new Date(Date.now() - VERIFY_SETTLE_GRACE_MS - 60_000),
      operationId: 'op-delivered-stale',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await taskModel.updateStatus(created.taskId!, 'running');
    await serverDB
      .update(tasks)
      .set({ updatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(tasks.id, created.taskId!));

    const released = await service.tick(graph.goal.id);

    expect(released.outcome).toBe('advanced');
    expect((await taskModel.findById(created.taskId!))?.status).toBe('backlog');
  });

  it('synthesizes the finding from the delivered topic, not a canceled retry', async () => {
    // When verification accepts a delivery, the settle path cancels the ghost
    // retry it superseded — leaving the canceled, handoff-less topic as the
    // newest row. Reading blindly by seq produced findings titled
    // "Completed: <task>" with no description.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Deliver me'], title: 'Consume the delivery' });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values([
      {
        handoff: {
          content: 'Delivered content with the full run summary.',
          summary: 'Delivered summary',
          title: 'Delivered title',
        },
        operationId: 'op-delivered',
        seq: 1,
        status: 'completed',
        taskId: created.taskId!,
        userId,
      },
      {
        operationId: 'op-ghost-retry',
        seq: 2,
        status: 'canceled',
        taskId: created.taskId!,
        userId,
      },
    ]);
    await taskModel.updateStatus(created.taskId!, 'completed');

    await service.tick(graph.goal.id);

    const finding = (await service.graph(graph.goal.id)).nodes.find(
      (node) => node.kind === 'finding',
    );
    expect(finding).toMatchObject({
      description: 'Delivered content with the full run summary.',
      title: 'Delivered title',
    });
  });

  it('leaves a fresh dispatch claim alone', async () => {
    // The same shape a moment after the claim is just a run about to start.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockRejectedValue(new Error('worker died'));
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Start me'], title: 'Fresh claim' });
    const created = await service.tick(graph.goal.id);
    await expect(service.tick(graph.goal.id)).rejects.toThrow('worker died');
    await taskModel.updateStatus(created.taskId!, 'running');

    const result = await service.tick(graph.goal.id);

    expect(result.outcome).toBe('waiting_external');
    expect((await taskModel.findById(created.taskId!))?.status).toBe('running');
  });

  it('reopens a goal its round budget stopped when the budget is raised', async () => {
    // `tick` refuses to move a paused goal, so without this the queued advance
    // returns straight away and the user has to find Resume as a second gesture.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      maxRounds: 1,
      title: 'Budget stopped',
      tasks: ['Costs a round'],
    });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(topics).values({ id: 'tpc_budget', userId });
    await serverDB
      .insert(taskTopics)
      .values({ seq: 1, taskId: created.taskId!, topicId: 'tpc_budget', userId });

    const stopped = await service.tick(graph.goal.id);
    expect(stopped.outcome).toBe('no_progress');
    expect(stopped.message).toContain('Round budget reached');
    expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');

    const raised = await service.setBudget(graph.goal.id, { maxRounds: 5 });

    expect(raised?.status).not.toBe('paused');
  });

  it('edits the standing requirement in place', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      requirement: '初版验收',
      tasks: ['A'],
      title: 'Editable',
    });

    const updated = await service.updateRequirement(graph.goal.id, '改过的验收标准');

    expect(updated.requirement).toBe('改过的验收标准');
    expect((await service.graph(graph.goal.id)).goal.requirement).toBe('改过的验收标准');
    await expect(service.updateRequirement('goal_missing', 'x')).rejects.toThrow();
  });

  it('leaves a deliberately paused goal paused when its budget changes', async () => {
    // Nothing distinguishes a user pause from a budget pause on the row, so the
    // reopen is limited to goals whose budget was actually binding.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Wait'], title: 'User paused' });
    await service.pause(graph.goal.id);

    const updated = await service.setBudget(graph.goal.id, { maxTotalCost: 50 });

    expect(updated?.status).toBe('paused');
  });

  it('refuses to delete a goal whose running Task cannot be stopped', async () => {
    // Deleting anyway would remove the only surface that can stop an operation
    // which keeps spending.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Runs on'], title: 'Unstoppable' });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(topics).values({ id: 'tpc_stuck', userId });
    await new TaskTopicModel(serverDB, userId).add(created.taskId!, 'tpc_stuck', { seq: 1 });
    await new TaskTopicModel(serverDB, userId).updateStatus(
      created.taskId!,
      'tpc_stuck',
      'running',
    );
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockRejectedValue(new Error('gateway is down'));

    await expect(service.delete(graph.goal.id)).rejects.toThrow(/not deleted/);
    expect(await service.graph(graph.goal.id)).toBeDefined();
  });

  it('plans the decomposition when a goal has no tasks yet', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '核心问题的一句话陈述',
      tasks: [
        { dependsOn: [], instruction: '收集原始材料', title: '方向A:收集' },
        { dependsOn: [0], instruction: '分析并综合结论', title: '方向B:分析' },
        // Self and forward references are planner hallucinations — dropped.
        { dependsOn: [1, 2, 9], instruction: '汇编最终报告', title: '方向C:汇编' },
      ],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      problemDescription: '用户的原话',
      requirement: '完整需求与验收标准全文',
      title: 'Complex ask',
    });
    // The seeded graph carries the user's own words, not the contract blob.
    expect(graph.nodes.find((n) => n.kind === 'problem')?.description).toBe('用户的原话');
    expect(graph.nodes.filter((n) => n.kind === 'task')).toHaveLength(0);

    const result = await service.tick(graph.goal.id);

    expect(result.outcome).toBe('advanced');
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'task').map((n) => n.title)).toEqual([
      '方向A:收集',
      '方向B:分析',
      '方向C:汇编',
    ]);
    expect(after.nodes.find((n) => n.kind === 'problem')?.description).toBe('核心问题的一句话陈述');
    expect(after.edges.filter((e) => e.kind === 'decomposes')).toHaveLength(3);

    // The planner's dependsOn indices become depends_on edges, dependent →
    // prerequisite; the self and forward references were dropped.
    const byTitle = new Map(after.nodes.map((n) => [n.title, n.id]));
    const deps = after.edges
      .filter((e) => e.kind === 'depends_on')
      .map((e) => [e.sourceNodeId, e.targetNodeId]);
    expect(deps).toHaveLength(2);
    expect(deps).toEqual(
      expect.arrayContaining([
        [byTitle.get('方向B:分析'), byTitle.get('方向A:收集')],
        [byTitle.get('方向C:汇编'), byTitle.get('方向B:分析')],
      ]),
    );
  });

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

  it('files a goal the agent created under that agent, not its owner', async () => {
    // `/goal` is an agent making the call. `agentId` alone cannot say so — the
    // creation modal sets it too, and there the author is the person.
    await serverDB
      .insert(agents)
      .values({ id: 'agt_goal_author', slug: 'agt-goal-author', userId });
    const service = new GoalService(serverDB, userId);

    const graph = await service.create({
      agentId: 'agt_goal_author',
      createdByAgentId: 'agt_goal_author',
      title: 'Agent-authored goal',
      tasks: ['Do the thing'],
    });

    const seeded = graph.events.filter((event) => ['created', 'linked'].includes(event.eventType));
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((event) => event.actorType === 'agent')).toBe(true);
    expect(seeded.every((event) => event.actorId === 'agt_goal_author')).toBe(true);
    expect(graph.nodes.every((node) => node.createdByAgentId === 'agt_goal_author')).toBe(true);
  });

  it('still files a goal the user created under the user, even on an agent page', async () => {
    // The modal passes `agentId` for assignment; the author is the person.
    await serverDB.insert(agents).values({ id: 'agt_assignee', slug: 'agt-assignee', userId });
    const service = new GoalService(serverDB, userId);

    const graph = await service.create({
      agentId: 'agt_assignee',
      title: 'User-authored goal',
      tasks: ['Do the thing'],
    });

    const seeded = graph.events.filter((event) => ['created', 'linked'].includes(event.eventType));
    expect(seeded.every((event) => event.actorType === 'user')).toBe(true);
    expect(seeded.every((event) => event.actorId === userId)).toBe(true);
  });

  it('separates what the coordinator decided from what the user asked for', async () => {
    // The audit trail recorded every transition as the goal's owner, so "what did
    // the system decide on its own" could not be answered from product data.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Do the thing'], title: 'Attributed goal' });

    // Seeding is the user's ask; claiming the Task and binding its runner is not.
    await service.tick(graph.goal.id);

    const { events, nodes } = await service.graph(graph.goal.id);
    const task = nodes.find((node) => node.kind === 'task')!;
    const actorsFor = (eventType: string, entityId: string) =>
      events
        .filter((event) => event.eventType === eventType && event.entityId === entityId)
        .map((event) => ({ actorId: event.actorId, actorType: event.actorType }));

    expect(actorsFor('created', task.id)).toEqual([{ actorId: userId, actorType: 'user' }]);
    expect(actorsFor('activated', task.id)).toEqual([
      { actorId: GOAL_COORDINATOR_ACTOR_ID, actorType: 'system' },
    ]);
    expect(events.some((event) => event.actorType === 'system')).toBe(true);
  });

  it('keeps the overall requirement as background while making the current Task authoritative', async () => {
    const service = new GoalService(serverDB, userId);
    const requirement = `Generate verified training data. ${'Detailed acceptance evidence. '.repeat(20)}`;
    const graph = await service.create({
      requirement,
      title: 'Long requirement goal',
      tasks: ['Generate training data'],
    });

    const created = await service.tick(graph.goal.id);
    const task = await new TaskModel(serverDB, userId).findById(created.taskId!);

    expect(created.outcome).toBe('advanced');
    expect(task?.description).toBe('Generate training data');
    expect(task?.instruction).toContain(requirement);
    expect(task?.instruction).toContain(
      'Current Task contract (authoritative execution scope): Generate training data',
    );
    expect(task?.instruction).toContain('Do not implement, validate, or pre-empt any sibling');
    expect(task?.instruction).toContain('run it inside this Task');
    expect(task?.instruction).toContain(
      'Include the relevant artifact contents or exact excerpts and the raw outputs of decisive verification commands',
    );
  });

  it('gates every responsible task with a Task-scoped Acceptance requirement', async () => {
    const service = new GoalService(serverDB, userId);
    const agentId = 'goal-work-verifier-agent';
    await serverDB.insert(agents).values({ id: agentId, title: 'Goal worker', userId });
    const graph = await service.create({
      agentId,
      requirement: 'Generate data, then train and evaluate a model.',
      title: 'Two-stage experiment',
      tasks: ['Generate isolated data'],
    });

    const created = await service.tick(graph.goal.id);
    const taskModel = new TaskModel(serverDB, userId);
    const task = await taskModel.findById(created.taskId!);
    const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject(
      'task',
      created.taskId!,
    );

    expect(taskModel.shouldPauseOnTopicComplete(task!)).toBe(false);
    expect(task?.config).not.toHaveProperty('verify');
    expect(acceptance).toMatchObject({ config: { enabled: true } });
    expect(acceptance?.config).not.toHaveProperty('verifierAgentId');
    expect(acceptance?.requirement).toContain('Verify only this Task: Generate isolated data.');
    expect(acceptance?.requirement).toContain(
      'Ignore sibling and downstream Task deliverables; they are verified by their own acceptance runs.',
    );
  });

  it('requires a Goal-level Acceptance Task before marking the complete goal achieved', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'A runnable minimal training loop with evidence',
      title: 'Reproduce Ornith training',
      tasks: ['Implement minimal training loop'],
    });

    const created = await service.tick(graph.goal.id);
    expect(created).toMatchObject({ outcome: 'advanced' });
    expect(created.taskId).toBeDefined();

    const waitingGraph = await service.graph(graph.goal.id);
    expect(waitingGraph.nodes.find((node) => node.kind === 'task')).toMatchObject({
      status: 'active',
      taskId: created.taskId,
    });
    expect(waitingGraph.workVersions).toHaveLength(1);
    const responsibleTask = await taskModel.findById(created.taskId!);
    expect(responsibleTask).toBeDefined();
    expect(taskModel.shouldPauseOnTopicComplete(responsibleTask!)).toBe(false);

    await taskModel.updateStatus(created.taskId!, 'completed');
    const synthesized = await service.tick(graph.goal.id);
    expect(synthesized.outcome).toBe('advanced');

    const evolved = await service.graph(graph.goal.id);
    expect(evolved.nodes.some((node) => node.kind === 'finding')).toBe(true);
    expect(evolved.edges.some((edge) => edge.kind === 'produces')).toBe(true);

    const goalAcceptanceCreated = await service.tick(graph.goal.id);
    expect(goalAcceptanceCreated).toMatchObject({
      message: 'Created Goal-level acceptance Task for the remaining contract',
      outcome: 'advanced',
    });
    const acceptanceWork = (await service.graph(graph.goal.id)).nodes.find(
      (node) => node.id === goalAcceptanceCreated.nodeId,
    );

    const acceptanceTaskCreated = await service.tick(graph.goal.id);
    expect(acceptanceTaskCreated).toMatchObject({ outcome: 'advanced' });
    const acceptanceTask = await taskModel.findById(acceptanceTaskCreated.taskId!);
    const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject(
      'task',
      acceptanceTaskCreated.taskId!,
    );
    expect(acceptanceTask?.instruction).toContain(
      'Complete and prove the overall Goal acceptance requirement',
    );
    expect(acceptance?.requirement).toContain('A runnable minimal training loop with evidence');
    expect(acceptance?.requirement).toContain(
      'An accurate gap analysis, a report that the Goal is not accepted',
    );
    expect(acceptance?.requirement).toContain('the verdict MUST be failed');
    expect(acceptanceWork?.description).toContain('Do not repeat expensive or destructive work');
    expect(acceptanceWork?.description).toContain('Run only the missing or stale checks');

    await taskModel.updateStatus(acceptanceTaskCreated.taskId!, 'completed');
    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');

    const achieved = await service.tick(graph.goal.id);
    expect(achieved).toMatchObject({
      message: 'Goal-level acceptance passed',
      outcome: 'achieved',
    });
    const finalGraph = await service.graph(graph.goal.id);
    expect(finalGraph.goal.status).toBe('achieved');
    // The verdict closes the map too: the seeded problem node has no other
    // resolution path, and must not read "active" on an achieved goal.
    expect(finalGraph.nodes.find((node) => node.kind === 'problem')).toMatchObject({
      status: 'resolved',
    });
  });

  it('does not mark a required goal achieved when only its initial Task is complete', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'Return a supplier list with fixed prices.',
      title: 'Find BW150 suppliers and fixed prices',
      tasks: ['Verify the BW150 product identity'],
    });

    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'completed');
    await service.tick(graph.goal.id);

    const result = await service.tick(graph.goal.id);
    const current = await service.graph(graph.goal.id);

    expect(result).toMatchObject({ outcome: 'advanced' });
    expect(current.goal.status).not.toBe('achieved');
    expect(current.nodes).toContainEqual(
      expect.objectContaining({
        kind: 'task',
        status: 'proposed',
        title: 'Complete full Goal acceptance',
      }),
    );
  });

  it('creates only one Goal-level Acceptance Task when terminal ticks race', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'Return three verified supplier quotes.',
      title: 'Find supplier quotes',
      tasks: ['Research suppliers'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'completed');
    await service.tick(graph.goal.id);

    await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);
    const current = await service.graph(graph.goal.id);
    const acceptanceWorks = current.nodes.filter(
      (node) => node.title === 'Complete full Goal acceptance',
    );

    expect(acceptanceWorks).toHaveLength(1);
    expect(
      current.edges.filter(
        (edge) => edge.kind === 'decomposes' && edge.targetNodeId === acceptanceWorks[0].id,
      ),
    ).toHaveLength(1);
  });

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

  it('evolves a failed task into a durable decision gate', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Risky task'], title: 'Failure recovery' });
    const created = await service.tick(graph.goal.id);

    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });
    const waiting = await service.tick(graph.goal.id);
    expect(waiting.outcome).toBe('waiting_human');

    const gated = await service.graph(graph.goal.id);
    const decision = gated.decisions[0];
    expect(decision).toMatchObject({ recommendedOptionId: 'retry', status: 'pending' });
    expect(gated.nodes.some((node) => node.kind === 'decision')).toBe(true);

    await service.decide(graph.goal.id, decision.id, 'retire', 'This branch is not useful');
    const achieved = await service.tick(graph.goal.id);
    expect(achieved.outcome).toBe('achieved');
  });

  it('reports the effects a tick actually produced, not just its outcome', async () => {
    // The rollup counts gates and findings from these effects, so a branch that
    // forgets to report one reads as "no human was ever involved" — silently,
    // and only in the trace. Driving the real path is the only thing that
    // catches it; a synthetic observation always agrees with itself.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Risky task'], title: 'Effect reporting' });

    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });

    const observed: GoalTickObservation[] = [];
    const gated = await service.tick(graph.goal.id, {
      onDecision: (observation) => observed.push(observation),
    });

    expect(gated.outcome).toBe('waiting_human');
    expect(observed.at(-1)!.effects).toContainEqual(
      expect.objectContaining({ detail: 'Verifier rejected output', type: 'opened_decision' }),
    );

    // And the other half: a completed task folds into a finding, which is what
    // `findingsTotal` counts.
    const decision = (await service.graph(graph.goal.id)).decisions[0];
    await service.decide(graph.goal.id, decision.id, 'retry');
    await taskModel.updateStatus(created.taskId!, 'completed');

    const consumed: GoalTickObservation[] = [];
    await service.tick(graph.goal.id, { onDecision: (o) => consumed.push(o) });

    expect(consumed.at(-1)!.effects).toContainEqual(
      expect.objectContaining({ detail: 'finding', type: 'created_node' }),
    );
  });

  it('refuses to start a task once the goal is at its concurrency limit', async () => {
    // The planner's cap check is a fast path over a snapshot; two overlapping
    // advances can both read it below the limit. The count and the claim are
    // therefore taken together under a per-goal lock, and this is the assertion
    // that the enforcement — not the fast path — is what holds.
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockResolvedValue({ operationId: 'op-cap', taskId: 'placeholder' } as never);

    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { maxConcurrentTasks: 1 },
      title: 'Capped goal',
      tasks: ['First', 'Second'],
    });

    // Fill the single slot.
    const first = await service.tick(graph.goal.id);
    await service.tick(graph.goal.id);
    await taskModel.updateStatus(first.taskId!, 'running');
    runSpy.mockClear();

    // The second task exists and is unblocked, but there is no room for it.
    const capped = await service.tick(graph.goal.id);

    expect(capped.outcome).toBe('waiting_external');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('automatically retries failed Task verification within policy budget', async () => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({
      agentId: 'agent-recovery',
      assistantMessageId: 'message-assistant',
      autoStarted: true,
      createdAt: new Date().toISOString(),
      message: 'started',
      operationId: 'op-recovery',
      status: 'running',
      success: true,
      taskId: 'placeholder',
      taskIdentifier: 'T-recovery',
      timestamp: new Date().toISOString(),
      topicId: 'topic-recovery',
      userMessageId: 'message-user',
    });
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 3, maxStepsPerRun: 500 } },
      title: 'Recover BW 150 research',
      tasks: ['Verify Micron BW 150 suppliers'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });

    const recovered = await service.tick(graph.goal.id);

    expect(recovered).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
    expect(runSpy).toHaveBeenCalledWith({
      maxSteps: 500,
      taskId: created.taskId,
      trigger: 'goal',
    });
    expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
  });

  it('reclaims a stale running Task operation and starts the next attempt', async () => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({
      agentId: 'agent-recovery',
      assistantMessageId: 'message-assistant',
      autoStarted: true,
      createdAt: new Date().toISOString(),
      message: 'started',
      operationId: 'op-recovery',
      status: 'running',
      success: true,
      taskId: 'placeholder',
      taskIdentifier: 'T-recovery',
      timestamp: new Date().toISOString(),
      topicId: 'topic-recovery',
      userMessageId: 'message-user',
    });
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockResolvedValue([
      { operationId: 'op-stale', topicId: 'topic-stale' } as never,
    ]);
    const timeoutSpy = vi
      .spyOn(TaskTopicModel.prototype, 'updateStatus')
      .mockResolvedValue(undefined);
    const settleSpy = vi
      .spyOn(AgentOperationModel.prototype, 'settleStaleRunning')
      .mockResolvedValue(true);

    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: {
        recovery: { maxAttemptsPerTask: 3, operationLeaseTimeoutMs: 60_000 },
      },
      title: 'Recover interrupted work',
      tasks: ['Run a durable experiment'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'running');

    const recovered = await service.tick(graph.goal.id);

    expect(settleSpy).toHaveBeenCalledWith('op-stale', expect.any(Date), undefined);
    expect(timeoutSpy).toHaveBeenCalledWith(created.taskId, 'topic-stale', 'timeout');
    expect(runSpy).toHaveBeenCalledWith({
      maxSteps: undefined,
      taskId: created.taskId,
      trigger: 'goal',
    });
    expect(recovered).toMatchObject({
      message: expect.stringContaining('Recovered abandoned task'),
      outcome: 'waiting_external',
      taskId: created.taskId,
    });
  });

  it('charges stale Task usage before checking the replacement budget', async () => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockResolvedValue([
      { operationId: 'op-stale-cost', topicId: 'topic-stale-cost' } as never,
    ]);
    vi.spyOn(TaskTopicModel.prototype, 'updateStatus').mockResolvedValue(undefined);
    vi.spyOn(AgentRuntimeCoordinator.prototype, 'getOperationMetadata').mockResolvedValue({
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: 'running',
      totalCost: 0.75,
      totalSteps: 2,
    });

    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 3, operationLeaseTimeoutMs: 60_000 } },
      maxTotalCost: 0.5,
      title: 'Respect abandoned Work cost',
      tasks: ['Run an expensive experiment'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'running');
    await new AgentOperationModel(serverDB, userId).recordStart({
      operationId: 'op-stale-cost',
      taskId: created.taskId,
    });
    await serverDB
      .update(agentOperations)
      .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(agentOperations.id, 'op-stale-cost'));

    const recovered = await service.tick(graph.goal.id);

    expect(runSpy).not.toHaveBeenCalled();
    expect(recovered).toMatchObject({ outcome: 'waiting_human', taskId: created.taskId });
    expect(await new AgentOperationModel(serverDB, userId).findById('op-stale-cost')).toMatchObject(
      {
        status: 'abandoned',
        totalCost: 0.75,
      },
    );
  });

  it('does not reclaim a running Task operation without a persisted topic id', async () => {
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockResolvedValue([
      { operationId: 'op-without-topic', topicId: null } as never,
    ]);
    const settleSpy = vi.spyOn(AgentOperationModel.prototype, 'settleStaleRunning');

    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { operationLeaseTimeoutMs: 60_000 } },
      title: 'Wait for topic persistence',
      tasks: ['Run a durable experiment'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'running');

    const waiting = await service.tick(graph.goal.id);

    expect(settleSpy).not.toHaveBeenCalled();
    expect(waiting).toMatchObject({
      message: expect.stringContaining('is running'),
      outcome: 'waiting_external',
      taskId: created.taskId,
    });
  });

  it('starts a ready sibling Task even when a running Task row is older than the operation lease', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { operationLeaseTimeoutMs: 60_000 } },
      title: 'Keep parallel work moving',
      tasks: ['Long-running experiment', 'Independent analysis'],
    });
    const running = await service.tick(graph.goal.id);
    await taskModel.updateStatus(running.taskId!, 'running');
    await serverDB
      .update(tasks)
      .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(tasks.id, running.taskId!));

    const sibling = await service.tick(graph.goal.id);

    expect(sibling).toMatchObject({ outcome: 'advanced' });
    expect(sibling.taskId).not.toBe(running.taskId);
  });

  it('rolls back the operation reclaim when recovery bookkeeping fails', async () => {
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockResolvedValue([
      { operationId: 'op-atomic-recovery', topicId: 'topic-stale' } as never,
    ]);
    vi.spyOn(TaskTopicModel.prototype, 'updateStatus').mockRejectedValueOnce(
      new Error('topic update failed'),
    );

    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const operationModel = new AgentOperationModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { operationLeaseTimeoutMs: 60_000 } },
      title: 'Atomic abandoned recovery',
      tasks: ['Run a durable experiment'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'running');
    await operationModel.recordStart({ operationId: 'op-atomic-recovery' });
    await serverDB
      .update(agentOperations)
      .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(agentOperations.id, 'op-atomic-recovery'));

    await expect(service.tick(graph.goal.id)).rejects.toThrow('topic update failed');

    expect((await operationModel.findById('op-atomic-recovery'))?.status).toBe('running');
    expect((await taskModel.findById(created.taskId!))?.status).toBe('running');
  });

  it('resumes automatic recovery after the atomic bookkeeping transaction committed', async () => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({
      agentId: 'agent-recovery',
      assistantMessageId: 'message-assistant',
      autoStarted: true,
      createdAt: new Date().toISOString(),
      message: 'started',
      operationId: 'op-recovery-next',
      status: 'running',
      success: true,
      taskId: 'placeholder',
      taskIdentifier: 'T-recovery',
      timestamp: new Date().toISOString(),
      topicId: 'topic-recovery-next',
      userMessageId: 'message-user',
    });
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 3 } },
      title: 'Resume abandoned recovery',
      tasks: ['Run a durable experiment'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Goal Task operation lease expired.',
    });

    const recovered = await service.tick(graph.goal.id);

    expect(runSpy).toHaveBeenCalledOnce();
    expect(recovered).toMatchObject({
      message: expect.stringContaining('Recovered abandoned task'),
      outcome: 'waiting_external',
    });
  });

  it('opens the decision gate only after the Task attempt budget is exhausted', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 1 } },
      title: 'Bounded recovery',
      tasks: ['Verify Micron BW 150 suppliers'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });

    const waiting = await service.tick(graph.goal.id);

    expect(waiting.outcome).toBe('waiting_human');
    expect((await service.graph(graph.goal.id)).decisions).toHaveLength(1);
  });

  it('fails the Goal when terminal acceptance is retired after recovery is exhausted', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 1 } },
      requirement: 'Return three verified supplier quotes.',
      title: 'Bounded terminal acceptance',
      tasks: ['Complete full Goal acceptance'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });
    await service.tick(graph.goal.id);
    const gated = await service.graph(graph.goal.id);

    expect(gated.decisions[0].options).toContainEqual({ id: 'fail', label: 'Fail goal' });
    await service.decide(graph.goal.id, gated.decisions[0].id, 'fail', 'No valid third quote');

    expect(await service.tick(graph.goal.id)).toMatchObject({ outcome: 'failed' });
    expect((await service.graph(graph.goal.id)).goal.status).toBe('failed');
  });

  it('respects a manually paused responsible task without rerunning it', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Wait for review'], title: 'Paused task' });
    const created = await service.tick(graph.goal.id);

    await taskModel.updateStatus(created.taskId!, 'paused', { error: null });
    const waiting = await service.tick(graph.goal.id);

    expect(waiting).toMatchObject({
      outcome: 'waiting_human',
      taskId: created.taskId,
    });
    expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
  });

  it('only selects Tasks whose explicit dependencies are resolved', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Dependency-aware goal' });
    const prerequisite = await service.addNode(graph.goal.id, {
      kind: 'task',
      priority: 0,
      title: 'Collect evidence',
    });
    const dependent = await service.addNode(graph.goal.id, {
      kind: 'task',
      priority: 10,
      title: 'Train from evidence',
    });
    await service.addEdge(graph.goal.id, dependent.id, prerequisite.id, 'depends_on');

    const first = await service.tick(graph.goal.id);
    expect(first).toMatchObject({ nodeId: prerequisite.id, outcome: 'advanced' });

    const taskModel = new TaskModel(serverDB, userId);
    await taskModel.updateStatus(first.taskId!, 'completed');
    await service.tick(graph.goal.id);

    const next = await service.tick(graph.goal.id);
    expect(next).toMatchObject({ nodeId: dependent.id, outcome: 'advanced' });
  });
});
