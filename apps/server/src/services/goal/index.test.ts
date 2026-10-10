// @vitest-environment node
import {
  DEVICE_OFFLINE_RUN_STATUS,
  GOAL_COORDINATOR_ACTOR_ID,
  GOAL_MACHINE_GATE_TITLE,
  QUOTA_LIMITED_RUN_STATUS,
} from '@lobechat/const/goal';
import type { ChatTopicMetadata } from '@lobechat/types';
import * as goalGraphUtils from '@lobechat/utils/goalGraph';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { MetricModel } from '@/database/models/metric';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { WorkModel } from '@/database/models/work';
import {
  acceptances,
  agentOperations,
  agents,
  documents,
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
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';
import { AiAgentService } from '@/server/services/aiAgent';

import { deviceGateway } from '../deviceGateway';
import { TaskService } from '../task';
import { TaskRunnerService } from '../taskRunner';
import { VerifyPlanGeneratorService } from '../verify/planGenerator';
import { GoalCriteriaGeneratorService } from './criteriaGenerator';
import {
  LEASE_EXPIRED_ERROR,
  VERIFICATION_ERRORED_ERROR,
  VERIFICATION_FAILED_ERROR,
} from './decideNextMove';
import { GoalExplorationPlanner } from './explorationPlanner';
import { GoalService } from './index';
import { MAX_QUOTA_RETRIES } from './machineRecovery';
import { DEVICE_OFFLINE_GATE_REASON, VERIFY_SETTLE_GRACE_MS } from './recoveryPolicy';
import * as scheduler from './scheduler';
import { LocalGoalScheduler } from './scheduler/impls';
import { TaskRecoveryCoordinator } from './taskRecoveryCoordinator';
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
  it('supervises every Goal it creates, even when the caller omits the policy', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Supervised by default' });
    expect(graph.goal.config?.supervision).toMatchObject({ enabled: true });
  });

  it('keeps the caller incident cap while forcing supervision on', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { supervision: { enabled: true, maxIncidents: 4 } },
      title: 'Capped supervision',
    });
    expect(graph.goal.config?.supervision).toEqual({ enabled: true, maxIncidents: 4 });
  });

  it('rejects a caller that tries to create an unsupervised Goal', async () => {
    const service = new GoalService(serverDB, userId);
    await expect(
      service.create({ config: { supervision: { enabled: false } }, title: 'No supervision' }),
    ).rejects.toThrow('Supervision is required for every goal and cannot be disabled');
  });

  it('explores after result settlement and dispatches the new graph node through the ordinary Task path', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      title: 'Explore',
      config: { exploration: { instruction: 'Compare evidence', maxExperiments: 3 } },
    });
    const parent = graph.nodes.find((node) => node.kind === 'task')!;
    await serverDB.update(goals).set({ status: 'running' }).where(eq(goals.id, graph.goal.id));
    await serverDB.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, parent.id));
    const planner = vi.spyOn(GoalExplorationPlanner.prototype, 'plan').mockResolvedValue({
      action: 'expand',
      parentNodeId: graph.nodes.find((node) => node.kind === 'experiment')!.id,
      title: 'Alternative',
      instruction: 'Improve baseline',
      reason: 'Try a new direction',
    });
    const expanded = await service.tick(graph.goal.id);
    expect(expanded).toMatchObject({ outcome: 'advanced', message: 'Try a new direction' });
    expect(planner).toHaveBeenCalledOnce();
    const created = await service.tick(graph.goal.id);
    expect(created.outcome).toBe('advanced');
    expect(created.nodeId).not.toBe(expanded.nodeId);
    expect((await service.graph(graph.goal.id)).edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: expanded.nodeId,
        targetNodeId: created.nodeId,
        kind: 'contains',
      }),
    );
    expect(created.taskId).toBeTruthy();
  });

  it('pauses a failed exploration planner without creating a phantom experiment', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      title: 'Explore',
      config: { exploration: { instruction: 'Compare evidence', maxExperiments: 3 } },
    });
    const parent = graph.nodes.find((node) => node.kind === 'task')!;
    await serverDB.update(goals).set({ status: 'running' }).where(eq(goals.id, graph.goal.id));
    await serverDB.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, parent.id));
    vi.spyOn(GoalExplorationPlanner.prototype, 'plan').mockRejectedValue(
      new Error('provider unavailable'),
    );
    expect(await service.tick(graph.goal.id)).toMatchObject({ outcome: 'no_progress' });
    const after = await service.graph(graph.goal.id);
    expect(after.goal.status).toBe('paused');
    expect(after.nodes.filter((node) => node.kind === 'task')).toHaveLength(1);
  });

  it('resumes an exhausted exploration only after increasing its cap, preserving explicit user pause', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      title: 'Explore',
      config: { exploration: { instruction: 'Compare evidence', maxExperiments: 1 } },
    });
    const parent = graph.nodes.find((node) => node.kind === 'task')!;
    await serverDB.update(goals).set({ status: 'running' }).where(eq(goals.id, graph.goal.id));
    await serverDB.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, parent.id));
    vi.spyOn(GoalExplorationPlanner.prototype, 'plan').mockResolvedValue({
      action: 'expand',
      parentNodeId: parent.id,
      title: 'Alternative',
      instruction: 'Improve baseline',
      reason: 'Still insufficient',
    });
    await service.tick(graph.goal.id);
    expect((await service.setBudget(graph.goal.id, { maxExperiments: 1 })).status).toBe('paused');
    expect((await service.setBudget(graph.goal.id, { maxExperiments: 2 })).status).toBe('running');
    await service.pause(graph.goal.id);
    expect((await service.setBudget(graph.goal.id, { maxExperiments: 3 })).status).toBe('paused');
  });

  it('passes the selected older experiment result into the actual child Task instruction', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      title: 'Text exploration',
      config: { exploration: { instruction: 'Compare alternatives', maxExperiments: 3 } },
    });
    const graphModel = new GoalGraphModel(serverDB, userId);
    const parent = graph.nodes.find((node) => node.kind === 'task')!;
    await serverDB.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, parent.id));
    const finding = await graphModel.createNode(graph.goal.id, {
      kind: 'finding',
      title: 'Baseline result',
      description: 'HISTORICAL_EVIDENCE_731: candidate A scored 7.',
    });
    await graphModel.createEdge(graph.goal.id, parent.id, finding!.id, 'produces');
    await graphModel.createNode(graph.goal.id, {
      kind: 'task',
      title: 'Newer alternative',
      status: 'resolved',
    });
    const child = await graphModel.createNode(graph.goal.id, {
      kind: 'task',
      title: 'Revisit baseline',
      description: 'Try changing A',
    });
    await graphModel.createEdge(graph.goal.id, child!.id, parent.id, 'derived_from');
    const created = await service.tick(graph.goal.id);
    const dispatched = await new TaskModel(serverDB, userId).findById(created.taskId!);
    expect(dispatched?.instruction).toContain(parent.id);
    expect(dispatched?.instruction).toContain('HISTORICAL_EVIDENCE_731: candidate A scored 7.');
    expect(dispatched?.instruction).toContain('Try changing A');
  });

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

  it('persists the reviewed goal document verbatim when structured criteria are supplied', async () => {
    const service = new GoalService(serverDB, userId);
    const instruction = '将办公体验提升到可交付水平，支持 PPT、XLSX、Word 的创建和定向修改。';
    const graph = await service.create({
      criteria: [{ instruction: '打开并编辑最终文件', title: '三类办公文档端到端可用' }],
      problemDescription: instruction,
      requirement: instruction,
      tasks: ['Only task'],
      title: '办公体验',
    });

    const persisted = await service.graph(graph.goal.id);
    expect(persisted.goal.requirement).toBe(instruction);
    expect(persisted.nodes.find((node) => node.kind === 'problem')?.description).toBe(instruction);
    expect(persisted.goal.config?.acceptance?.criteriaIds).toHaveLength(1);
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

  it.each([
    { action: 'verify', managerEnabled: true },
    { action: 'verify', managerEnabled: false },
    { action: 'tasks', managerEnabled: true },
  ] as const)(
    'scopes the handoff to manager=$managerEnabled action=$action',
    async ({ action, managerEnabled }) => {
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const requirement = 'Deliver the original result with independently inspectable evidence';
      const handoff =
        'Clarify that zero calls means zero additional predictions, not zero LLM use.';
      const graph = await service.create({
        criteria: [{ title: 'Original evidence criterion' }],
        requirement,
        tasks: ['Prepare result'],
        title: 'Handoff',
      });
      const prepared = await service.tick(graph.goal.id);
      await taskModel.updateStatus(prepared.taskId!, 'completed');
      await service.tick(graph.goal.id);
      const originalConfig = (await service.graph(graph.goal.id)).goal.config;
      await serverDB
        .update(goals)
        .set({
          config: {
            ...originalConfig,
            manager: managerEnabled ? {} : undefined,
            managerState: {
              consumed: true,
              readyForAcceptance: true,
              snapshot: 'settled',
              startedAt: new Date().toISOString(),
              submitted: { action, reason: handoff },
              token: 'verified-turn',
              topicId: 'management-topic',
              turns: 1,
            },
          },
        })
        .where(eq(goals.id, graph.goal.id));

      await service.tick(graph.goal.id);
      const finalTask = await service.tick(graph.goal.id);
      const task = await taskModel.findById(finalTask.taskId!);

      if (managerEnabled && action === 'verify') {
        expect(task?.instruction).toContain(handoff);
        expect(task?.instruction).toContain('context only, not acceptance criteria');
      } else {
        expect(task?.instruction).not.toContain(handoff);
      }
      const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject(
        'task',
        finalTask.taskId!,
      );
      expect(acceptance?.requirement).toContain(requirement);
      expect(acceptance?.config?.verifyCriteriaIds).toEqual(
        originalConfig?.acceptance?.criteriaIds,
      );
      expect(acceptance?.config?.verifyCriteriaIds).toHaveLength(1);
      expect((await service.graph(graph.goal.id)).goal.requirement).toBe(requirement);
    },
  );

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

  it.each([
    [LEASE_EXPIRED_ERROR, 'completed'],
    [LEASE_EXPIRED_ERROR, 'failed'],
    [VERIFICATION_ERRORED_ERROR, 'completed'],
    [VERIFICATION_ERRORED_ERROR, 'canceled'],
  ])('does not restart a Task settled during recovery (%s → %s)', async (error, settledAs) => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      title: `Settled during recovery ${error} ${settledAs}`,
      tasks: ['Do not restart'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error });
    // The advance routed here holding the paused row; a person settled the Task
    // before the claim, which is the row the coordinator now reads.
    const stale = (await taskModel.findById(created.taskId!))!;
    await taskModel.updateStatus(created.taskId!, settledAs, { error: null });
    runSpy.mockClear();

    const recovery = await new TaskRecoveryCoordinator(serverDB, userId).recover({
      goal: (await service.graph(graph.goal.id)).goal,
      task: stale,
    });

    expect(recovery.outcome).toBe('settled');
    expect(runSpy).not.toHaveBeenCalled();
    expect((await taskModel.findById(created.taskId!))?.status).toBe(settledAs);
  });

  it.each([LEASE_EXPIRED_ERROR, VERIFICATION_ERRORED_ERROR])(
    'does not start a recovery run once the goal is fenced for closing (%s)',
    async (error) => {
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({} as never);
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const graph = await service.create({ title: `Fenced recovery ${error}`, tasks: ['Stop'] });
      const created = await service.tick(graph.goal.id);
      await taskModel.updateStatus(created.taskId!, 'paused', { error });
      // The tick decided on a running goal; `close` then paused it under the
      // goal row lock before scanning live runs.
      const decidedOn = (await service.graph(graph.goal.id)).goal;
      const task = (await taskModel.findById(created.taskId!))!;
      await service.pause(graph.goal.id);
      runSpy.mockClear();

      const recovery = await new TaskRecoveryCoordinator(serverDB, userId).recover({
        goal: decidedOn,
        task,
      });

      expect(recovery.outcome).toBe('goal-stopped');
      expect(runSpy).not.toHaveBeenCalled();
      expect((await taskModel.findById(created.taskId!))?.status).toBe('paused');
      expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');
    },
  );

  it('does not restart a Task a person paused themselves', async () => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      title: 'Actor paused during recovery',
      tasks: ['Do not restart'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: VERIFICATION_ERRORED_ERROR });
    // A manual round trip keeps the routing error, because the status update replaces
    // it only when a new one is supplied, so the final pause is the person's.
    const taskService = new TaskService(serverDB, userId);
    await taskService.updateStatus({ id: created.taskId!, status: 'failed' }, { userId });
    await taskService.updateStatus({ id: created.taskId!, status: 'paused' }, { userId });
    const stale = (await taskModel.findById(created.taskId!))!;
    runSpy.mockClear();

    const recovery = await new TaskRecoveryCoordinator(serverDB, userId).recover({
      goal: (await service.graph(graph.goal.id)).goal,
      task: stale,
    });

    expect(recovery.outcome).toBe('settled');
    expect(runSpy).not.toHaveBeenCalled();
    expect((await taskModel.findById(created.taskId!))?.status).toBe('paused');
  });

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

  it('links what the task delivered to its node, and skips the task Work itself', async () => {
    // The deliverable used to survive only as a URL inside the finding's prose:
    // the graph recorded that a task finished but not what came out of it.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Deliver me'], title: 'Harvest deliverables' });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered', title: 'Delivered title' },
      operationId: 'op-delivered',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await workModel.registerExternal({
      changeType: 'created',
      identifier: 'ENG-7',
      resourceId: 'lobehub/lobehub#7',
      resourceType: 'github_issue',
      rootOperationId: 'op-delivered',
      title: 'The delivered issue',
      toolIdentifier: 'lobe-github',
      toolName: 'createIssue',
    });
    await taskModel.updateStatus(created.taskId!, 'completed');

    await service.tick(graph.goal.id);

    const snapshot = await service.graph(graph.goal.id);
    const linked = snapshot.workVersions.filter((link) => link.nodeId === created.nodeId);
    expect(linked.some((link) => link.work?.title === 'The delivered issue')).toBe(true);
    // The responsible task's own Work is still linked — it is the execution
    // container, and the client is what filters it out of the deliverable list.
    expect(linked.some((link) => link.work?.type === 'task')).toBe(true);
  });

  it('re-settling a task does not duplicate its deliverable links', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Deliver me'], title: 'Idempotent harvest' });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered', title: 'Delivered title' },
      operationId: 'op-delivered',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await workModel.registerExternal({
      changeType: 'created',
      resourceId: 'lobehub/lobehub#8',
      resourceType: 'github_issue',
      rootOperationId: 'op-delivered',
      title: 'Delivered once',
      toolIdentifier: 'lobe-github',
      toolName: 'createIssue',
    });
    await taskModel.updateStatus(created.taskId!, 'completed');

    await service.tick(graph.goal.id);
    await service.tick(graph.goal.id);

    const snapshot = await service.graph(graph.goal.id);
    const delivered = snapshot.workVersions.filter(
      (link) => link.nodeId === created.nodeId && link.work?.title === 'Delivered once',
    );
    expect(delivered).toHaveLength(1);
    // The execution container is claimed once per node too, not once per
    // settle: re-linking the completed version added a second identical row for
    // the same task, which is where half of a goal's Work links came from.
    expect(
      snapshot.workVersions.filter(
        (link) => link.nodeId === created.nodeId && link.work?.type === 'task',
      ),
    ).toHaveLength(1);
  });

  it('does not declare a shared document a task only revised', async () => {
    // A backlog document every task appends to used to be declared as the
    // output of every task that touched it, because a Work registered during a
    // run counted as that run's deliverable. Only a Work one of the task's own
    // runs created is one; a revision is not a delivery.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const graph = await service.create({
      tasks: ['Deliver me'],
      title: 'Revisions are not deliveries',
    });
    const created = await service.tick(graph.goal.id);
    const [backlog] = await serverDB
      .insert(documents)
      .values({
        content: 'Shared backlog body',
        fileType: 'markdown',
        filename: 'Shared backlog',
        source: 'notebook',
        sourceType: 'api',
        title: 'Shared backlog',
        totalCharCount: 19,
        totalLineCount: 1,
        userId,
      })
      .returning();
    // Written by an earlier task's run; this task only appends to it.
    await workModel.registerDocument({
      changeType: 'created',
      documentId: backlog.id,
      rootOperationId: 'op-wrote-it-first',
      toolIdentifier: 'lobehub-notebook',
      toolName: 'createDocument',
    });
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered', title: 'Delivered title' },
      operationId: 'op-delivered',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await workModel.registerDocument({
      changeType: 'updated',
      documentId: backlog.id,
      rootOperationId: 'op-delivered',
      toolIdentifier: 'lobe-agent-documents',
      toolName: 'modifyNodes',
    });
    await taskModel.updateStatus(created.taskId!, 'completed');

    await service.tick(graph.goal.id);

    const snapshot = await service.graph(graph.goal.id);
    expect(
      snapshot.workVersions.filter(
        (link) => link.nodeId === created.nodeId && link.work?.resourceId === backlog.id,
      ),
    ).toHaveLength(0);
  });

  it('declares a deliverable once, on the node that delivered it', async () => {
    // The flare case behind the reported duplicate deliverables: one document
    // delivered by a node, then written again by another node's run, appeared
    // as a deliverable of both.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const graph = await service.create({
      tasks: ['First delivery', 'Second delivery'],
      title: 'One claim per deliverable',
    });
    const [backlog] = await serverDB
      .insert(documents)
      .values({
        content: 'Shared backlog body',
        fileType: 'markdown',
        filename: 'Shared backlog',
        source: 'notebook',
        sourceType: 'api',
        title: 'Shared backlog',
        totalCharCount: 19,
        totalLineCount: 1,
        userId,
      })
      .returning();

    const first = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered', title: 'Delivered title' },
      operationId: 'op-first',
      seq: 1,
      status: 'completed',
      taskId: first.taskId!,
      userId,
    });
    await workModel.registerDocument({
      changeType: 'created',
      documentId: backlog.id,
      rootOperationId: 'op-first',
      toolIdentifier: 'lobe-agent-documents',
      toolName: 'createDocument',
    });
    await taskModel.updateStatus(first.taskId!, 'completed');
    await service.tick(graph.goal.id);

    const second = await service.tick(graph.goal.id);
    expect(second.taskId).toBeTruthy();
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered again', title: 'Delivered again' },
      operationId: 'op-second',
      seq: 1,
      status: 'completed',
      taskId: second.taskId!,
      userId,
    });
    // The second node's run writes the same document (a new version of the same
    // Work), which is what a shared backlog looks like from the graph's side.
    await workModel.registerDocument({
      changeType: 'created',
      documentId: backlog.id,
      rootOperationId: 'op-second',
      toolIdentifier: 'lobehub-notebook',
      toolName: 'createDocument',
    });
    await taskModel.updateStatus(second.taskId!, 'completed');
    await service.tick(graph.goal.id);

    const snapshot = await service.graph(graph.goal.id);
    const claims = snapshot.workVersions.filter(
      (link) => link.work?.resourceId === backlog.id && link.relation === 'produced',
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].nodeId).toBe(first.nodeId);
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

  describe('limits a goal was created with', () => {
    // A goal its main Agent paused for running out of turns: resuming it alone
    // pauses it again, which is what pushed agents into creating a copy of it.
    const turnSpentGoal = async (service: GoalService) => {
      const graph = await service.create({
        tasks: ['Keep working'],
        title: 'Out of main Agent turns',
      });
      const current = (await service.graph(graph.goal.id)).goal;
      await serverDB
        .update(goals)
        .set({
          config: {
            ...current.config,
            manager: { maxTurns: 2 },
            managerState: { turns: 2 } as never,
          },
          status: 'paused',
        })
        .where(eq(goals.id, graph.goal.id));
      return graph.goal.id;
    };

    it('resumes a goal its main Agent paused once the turn cap is raised', async () => {
      const service = new GoalService(serverDB, userId);
      const goalId = await turnSpentGoal(service);

      const raised = await service.setBudget(goalId, { maxManagerTurns: 20 });

      expect(raised.config?.manager?.maxTurns).toBe(20);
      expect(raised.status).not.toBe('paused');
    });

    it('keeps a goal paused when the raised cap is still spent', async () => {
      const service = new GoalService(serverDB, userId);
      const goalId = await turnSpentGoal(service);

      expect((await service.setBudget(goalId, { maxManagerTurns: 2 })).status).toBe('paused');
    });

    it('edits the execution limits without dropping the rest of the config', async () => {
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({
        config: { recovery: { maxAttemptsPerTask: 3, maxStepsPerRun: 200 } },
        tasks: ['Run'],
        title: 'Editable limits',
      });

      const updated = await service.setBudget(graph.goal.id, {
        maxAttemptsPerTask: 5,
        maxConcurrentTasks: 1,
        maxStepsPerRun: null,
      });

      expect(updated.config?.maxConcurrentTasks).toBe(1);
      expect(updated.config?.recovery).toMatchObject({
        maxAttemptsPerTask: 5,
        maxStepsPerRun: null,
      });
    });

    it('rejects a turn cap for a goal without a main Agent', async () => {
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({ tasks: ['Run'], title: 'No main Agent' });

      await expect(service.setBudget(graph.goal.id, { maxManagerTurns: 20 })).rejects.toThrow(
        'Only a Goal with a main Agent has a turn budget',
      );
    });
  });

  it('ships the spend the budget is enforced against with the graph', async () => {
    // The header renders `spent / cap` as one fraction, so the number it shows
    // has to be the number the coordinator will stop on — not the goal list's
    // subtree roll-up, which counts Tasks the graph's Tasks spawned.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      maxTotalCost: 10,
      tasks: ['Costs money'],
      title: 'Spend',
    });
    const created = await service.tick(graph.goal.id);

    await serverDB
      .insert(topics)
      .values({ id: 'tpc_spend_1', totalCost: 6.4, totalTokens: 1200, userId });
    await serverDB
      .insert(taskTopics)
      .values({ seq: 1, taskId: created.taskId!, topicId: 'tpc_spend_1', userId });
    // A run that has not settled is a round with no cost yet.
    await serverDB.insert(topics).values({ id: 'tpc_spend_2', userId });
    await serverDB
      .insert(taskTopics)
      .values({ seq: 2, taskId: created.taskId!, topicId: 'tpc_spend_2', userId });

    const { spend } = await service.graph(graph.goal.id);

    expect(spend).toMatchObject({ runs: 2, totalCost: 6.4, totalTokens: 1200 });
    // The cost panel lists WHERE the money went, so the same read carries the
    // per-Task split rather than only the total the budget is checked against.
    expect(spend?.byTask).toEqual([
      {
        runs: 2,
        taskId: created.taskId!,
        totalCost: 6.4,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 1200,
      },
    ]);
  });

  it('keeps an existing deadline when only the cost cap is edited', async () => {
    // The budget panel sends one dimension at a time; an omitted deadline used
    // to be written back as null, silently dropping a calendar budget someone
    // set from a click that only meant to raise the dollars.
    const service = new GoalService(serverDB, userId);
    const deadline = new Date(Date.now() + 3_600_000).toISOString();
    const graph = await service.create({
      config: { schedule: { deadline } },
      tasks: ['Bounded'],
      title: 'Deadline keeper',
    });

    const updated = await service.setBudget(graph.goal.id, { maxTotalCost: 25 });

    expect(updated?.config?.schedule?.deadline).toBe(deadline);
    expect(Number(updated?.maxTotalCost)).toBe(25);
  });

  it('leaves the round cap alone when only the cost cap is edited', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      maxRounds: 7,
      tasks: ['Bounded'],
      title: 'Round keeper',
    });

    const updated = await service.setBudget(graph.goal.id, { maxTotalCost: 25 });

    expect(updated?.maxRounds).toBe(7);
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

  it('names the agent each dispatched task node is assigned to', async () => {
    await serverDB.insert(agents).values([{ id: 'agt_exec', slug: 'agt-exec', userId }]);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      agentId: 'agt_exec',
      tasks: ['Dispatched', 'Not yet'],
      title: 'Who is on it',
    });
    const created = await service.tick(graph.goal.id);

    const read = await service.graph(graph.goal.id);
    const dispatched = read.nodes.find((node) => node.taskId === created.taskId)!;

    // Only a node with a Task row has an assignee; the undispatched one has none.
    expect(read.assignees).toEqual({ [dispatched.id]: 'agt_exec' });
  });

  it('hands the goal and its unfinished tasks to a new agent', async () => {
    await serverDB.insert(agents).values([
      { id: 'agt_old', slug: 'agt-old', userId },
      { id: 'agt_new', slug: 'agt-new', userId },
    ]);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      agentId: 'agt_old',
      tasks: ['Only task'],
      title: 'Handover',
    });
    const created = await service.tick(graph.goal.id);
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_old');

    const handed = await service.setAgent(graph.goal.id, 'agt_new');

    expect(handed.goal.agentId).toBe('agt_new');
    expect(handed.reassignedTaskIds).toEqual([created.taskId]);
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_new');

    // A finished task keeps the agent that did the work, and `goalOnly` limits
    // the change to future coordinator-created tasks.
    await taskModel.updateStatus(created.taskId!, 'completed');
    const back = await service.setAgent(graph.goal.id, 'agt_old');
    expect(back.reassignedTaskIds).toEqual([]);
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_new');

    await expect(service.setAgent(graph.goal.id, 'agt_missing')).rejects.toThrow();
  });

  it('falls back to the goal agent when the dedicated executor was deleted', async () => {
    await serverDB.insert(agents).values([
      { id: 'agt_lead_fallback', slug: 'agt-lead-fallback', userId },
      { id: 'agt_gone_executor', slug: 'agt-gone-executor', userId },
    ]);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      agentId: 'agt_lead_fallback',
      config: { taskAgentId: 'agt_gone_executor' },
      tasks: ['Only task'],
      title: 'Executor deleted',
    });
    await serverDB.delete(agents).where(eq(agents.id, 'agt_gone_executor'));

    const created = await service.tick(graph.goal.id);

    expect(created.taskId).toBeTruthy();
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_lead_fallback');
  });

  it('writes only the executor slot, so a concurrent policy edit survives', async () => {
    await serverDB.insert(agents).values([
      { id: 'agt_policy_lead', slug: 'agt-policy-lead', userId },
      { id: 'agt_policy_worker', slug: 'agt-policy-worker', userId },
    ]);
    const service = new GoalService(serverDB, userId);
    const model = new GoalModel(serverDB, userId);
    const graph = await service.create({ agentId: 'agt_policy_lead', title: 'Policy race' });
    // setTaskAgent reads the row, then a budget edit lands before it writes.
    const stale = (await model.findById(graph.goal.id))!;
    await model.update(graph.goal.id, { config: { ...stale.config, maxConcurrentTasks: 5 } });
    // `findById` is an instance arrow property, so spy on the service's own model.
    const serviceModel = (service as unknown as { goalModel: GoalModel }).goalModel;
    vi.spyOn(serviceModel, 'findById').mockResolvedValueOnce(stale);

    const result = await service.setTaskAgent(graph.goal.id, 'agt_policy_worker');

    expect(result.goal.config?.taskAgentId).toBe('agt_policy_worker');
    expect(result.goal.config?.maxConcurrentTasks).toBe(5);
  });

  it('moves supervision without moving the tasks a dedicated executor holds', async () => {
    await serverDB.insert(agents).values([
      { id: 'agt_supervisor', slug: 'agt-supervisor', userId },
      { id: 'agt_executor', slug: 'agt-executor', userId },
      { id: 'agt_next_supervisor', slug: 'agt-next-supervisor', userId },
    ]);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      agentId: 'agt_supervisor',
      config: { taskAgentId: 'agt_executor' },
      tasks: ['Only task'],
      title: 'Split roles',
    });
    expect(graph.goal.agentId).toBe('agt_supervisor');
    const created = await service.tick(graph.goal.id);
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_executor');

    const handed = await service.setAgent(graph.goal.id, 'agt_next_supervisor');

    expect(handed.goal.agentId).toBe('agt_next_supervisor');
    expect(handed.goal.config?.taskAgentId).toBe('agt_executor');
    expect(handed.reassignedTaskIds).toEqual([]);
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_executor');
  });

  it('routes tasks to a dedicated executor and back to the goal agent', async () => {
    await serverDB.insert(agents).values([
      { id: 'agt_owner', slug: 'agt-owner', userId },
      { id: 'agt_worker', slug: 'agt-worker', userId },
    ]);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      agentId: 'agt_owner',
      tasks: ['Only task'],
      title: 'Delegated',
    });
    const created = await service.tick(graph.goal.id);
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_owner');

    const delegated = await service.setTaskAgent(graph.goal.id, 'agt_worker');
    expect(delegated.goal.agentId).toBe('agt_owner');
    expect(delegated.goal.config?.taskAgentId).toBe('agt_worker');
    expect(delegated.reassignedTaskIds).toEqual([created.taskId]);
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_worker');

    // Naming the goal agent clears the slot rather than duplicating it.
    const back = await service.setTaskAgent(graph.goal.id, 'agt_owner');
    expect(back.goal.config?.taskAgentId).toBeUndefined();
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_owner');

    await expect(service.setTaskAgent(graph.goal.id, 'agt_missing')).rejects.toThrow();
  });

  it('restarts unfinished tasks under a new agent and cancels the stale runs they hold', async () => {
    const cancelSpy = vi.spyOn(TaskService.prototype, 'cancelTopic').mockResolvedValue();
    await serverDB.insert(agents).values({ id: 'agt_restart', slug: 'agt-restart', userId });
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Stuck task'], title: 'Restartable' });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(topics).values({ id: 'tpc_restart', userId });
    await new TaskTopicModel(serverDB, userId).add(created.taskId!, 'tpc_restart', { seq: 1 });
    await new TaskTopicModel(serverDB, userId).updateStatus(
      created.taskId!,
      'tpc_restart',
      'running',
    );
    await taskModel.update(created.taskId!, { error: 'lease expired', status: 'running' });

    const result = await service.restart(graph.goal.id, { agentId: 'agt_restart' });

    expect(cancelSpy).toHaveBeenCalledWith('tpc_restart');
    expect(result.goal.agentId).toBe('agt_restart');
    expect(result.restartedTaskIds).toEqual([created.taskId]);
    expect(await taskModel.findById(created.taskId!)).toMatchObject({
      assigneeAgentId: 'agt_restart',
      error: null,
      status: 'backlog',
    });

    // "Start over" on a parked goal must begin ticking again without a second
    // Resume gesture.
    await service.pause(graph.goal.id);
    const resumed = await service.restart(graph.goal.id);
    expect(resumed.goal.status).not.toBe('paused');
  });

  it('closes a goal by hand, stops its live runs and stops the coordinator', async () => {
    const cancelSpy = vi.spyOn(TaskService.prototype, 'cancelTopic').mockResolvedValue();
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['First', 'Second'], title: 'Closable' });
    const created = await service.tick(graph.goal.id);
    await new TaskModel(serverDB, userId).update(created.taskId!, { status: 'running' });
    await serverDB.insert(topics).values({ id: 'tpc_close', userId });
    await new TaskTopicModel(serverDB, userId).add(created.taskId!, 'tpc_close', { seq: 1 });
    await new TaskTopicModel(serverDB, userId).updateStatus(
      created.taskId!,
      'tpc_close',
      'running',
    );

    const closed = await service.close(graph.goal.id, 'canceled');

    expect(closed.status).toBe('canceled');
    expect(cancelSpy).toHaveBeenCalledWith('tpc_close');
    // Back to backlog, not parked on a person, so a reopen runs it again.
    expect((await new TaskModel(serverDB, userId).findById(created.taskId!))?.status).toBe(
      'backlog',
    );
    expect(await service.tick(graph.goal.id)).toMatchObject({ outcome: 'failed' });
    const [closeEvent] = await serverDB
      .select()
      .from(goalEvents)
      .where(eq(goalEvents.reason, 'canceled by user'));
    // Filed under the person, not the coordinator.
    expect(closeEvent).toMatchObject({ actorId: userId, eventType: 'rejected' });

    // A closed goal reopens through the ordinary resume.
    expect((await service.resume(graph.goal.id)).status).toBe('running');
    expect((await service.close(graph.goal.id, 'achieved')).status).toBe('achieved');
  });

  it('fences new dispatch before interrupting the runs of a goal being closed', async () => {
    // A tick overlapping the close must not claim another Task while the scan
    // and cancellation are under way, so the goal stops reading `running` first.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Runs'], title: 'Fenced' });
    const created = await service.tick(graph.goal.id);
    await new TaskModel(serverDB, userId).update(created.taskId!, { status: 'running' });
    await serverDB.insert(topics).values({ id: 'tpc_fence', userId });
    await new TaskTopicModel(serverDB, userId).add(created.taskId!, 'tpc_fence', { seq: 1 });
    await new TaskTopicModel(serverDB, userId).updateStatus(
      created.taskId!,
      'tpc_fence',
      'running',
    );
    const statusDuringCancel: string[] = [];
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockImplementation(async () => {
      const goal = await new GoalModel(serverDB, userId).findById(graph.goal.id);
      statusDuringCancel.push(goal!.status);
    });

    await service.close(graph.goal.id, 'canceled');

    expect(statusDuringCancel).toEqual(['paused']);
  });

  it('refuses to close while a claimed run is still starting, so it can be stopped with confirmation', async () => {
    // `dispatchWork` marks the Task running before `runTask` records the topic,
    // so the close scan finds no run to cancel — and a run nobody recorded
    // cannot be interrupted with confirmation. The close waits for it instead.
    const cancelSpy = vi.spyOn(TaskService.prototype, 'cancelTopic').mockResolvedValue();
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Starting'], title: 'Claimed, not recorded' });
    const created = await service.tick(graph.goal.id);
    await new TaskModel(serverDB, userId).update(created.taskId!, { status: 'running' });

    await expect(service.close(graph.goal.id, 'canceled')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });

    expect(cancelSpy).not.toHaveBeenCalled();
    // Fenced, so nothing new starts, and the claim is left for its run to record.
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe('paused');
    expect((await new TaskModel(serverDB, userId).findById(created.taskId!))?.status).toBe(
      'running',
    );
  });

  it('withdraws a claim whose startup died long ago and closes the goal', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Dead start'], title: 'Stale claim' });
    const created = await service.tick(graph.goal.id);
    await serverDB
      .update(tasks)
      .set({ status: 'running', updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
      .where(eq(tasks.id, created.taskId!));

    expect((await service.close(graph.goal.id, 'canceled')).status).toBe('canceled');
    expect((await new TaskModel(serverDB, userId).findById(created.taskId!))?.status).toBe(
      'backlog',
    );
  });

  it('keeps a closed goal closed when a stale decision is answered', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Risky task'], title: 'Closed with a gate' });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });
    await service.tick(graph.goal.id);
    const [decision] = (await service.graph(graph.goal.id)).decisions;

    await service.close(graph.goal.id, 'canceled');

    // Another tab still showing the gate answers it.
    await expect(service.decide(graph.goal.id, decision.id, 'retry')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe(
      'canceled',
    );
  });

  it('does not reopen a goal closed while a decision was being answered', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Risky task'], title: 'Closed mid-answer' });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });
    await service.tick(graph.goal.id);
    const [decision] = (await service.graph(graph.goal.id)).decisions;
    // The close lands after the answer is written, before the status moves.
    const graphModel = (service as unknown as { graphModel: GoalGraphModel }).graphModel;
    const resolve = graphModel.resolveDecision;
    vi.spyOn(graphModel, 'resolveDecision').mockImplementation(async (...args) => {
      const resolved = await resolve(...args);
      await new GoalService(serverDB, userId).close(graph.goal.id, 'canceled');
      return resolved;
    });

    await service.decide(graph.goal.id, decision.id, 'retry');

    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe(
      'canceled',
    );
  });

  it('refuses to end a goal someone resumed while its runs were being interrupted', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Runs'], title: 'Resumed mid-close' });
    const created = await service.tick(graph.goal.id);
    await new TaskModel(serverDB, userId).update(created.taskId!, { status: 'running' });
    await serverDB.insert(topics).values({ id: 'tpc_race', userId });
    await new TaskTopicModel(serverDB, userId).add(created.taskId!, 'tpc_race', { seq: 1 });
    await new TaskTopicModel(serverDB, userId).updateStatus(created.taskId!, 'tpc_race', 'running');
    // Another tab resumes the goal while the interruption pass is running.
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockImplementation(async () => {
      await new GoalService(serverDB, userId).resume(graph.goal.id);
    });

    await expect(service.close(graph.goal.id, 'canceled')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe('running');
  });

  it('does not let a resume that read the goal before a close reopen it afterwards', async () => {
    // The resume read the fenced `paused` goal; the close then committed the
    // terminal status. The stale resume must not write `running` over it.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Runs'], title: 'Resume after close' });
    await service.pause(graph.goal.id);
    const requireGraph = (service as unknown as { requireGraph: GoalService['graph'] })
      .requireGraph;
    vi.spyOn(service as any, 'requireGraph').mockImplementationOnce(async (id) => {
      const snapshot = await requireGraph(id as string);
      await new GoalService(serverDB, userId).close(graph.goal.id, 'canceled');
      return snapshot;
    });

    await expect(service.resume(graph.goal.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe(
      'canceled',
    );
    // An explicit reopen of the ended goal still works.
    expect((await service.resume(graph.goal.id)).status).toBe('running');
  });

  it('keeps runs already stopped reopenable when a later interruption fails', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const topicModel = new TaskTopicModel(serverDB, userId);
    const graph = await service.create({ tasks: ['First', 'Second'], title: 'Partial close' });
    const [first, second] = graph.nodes.filter((node) => node.kind === 'task');
    const taskIds: string[] = [];
    for (const [index, node] of [first, second].entries()) {
      const task = await new TaskService(serverDB, userId).createTask({
        instruction: node.title,
        name: node.title,
      });
      await new GoalGraphModel(serverDB, userId).bindTask(graph.goal.id, node.id, task.id);
      await taskModel.update(task.id, { status: 'running' });
      const topicId = `tpc_partial_${index}`;
      await serverDB.insert(topics).values({ id: topicId, userId });
      await topicModel.add(task.id, topicId, { seq: 1 });
      await topicModel.updateStatus(task.id, topicId, 'running');
      taskIds.push(task.id);
    }
    // The first interruption lands (the task reads `paused`, as cancelTopic
    // leaves it); the second is unreachable.
    let calls = 0;
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockImplementation(async (topicId) => {
      calls += 1;
      if (calls > 1) throw new Error('run unreachable');
      const index = Number(topicId.at(-1));
      await taskModel.update(taskIds[index], { status: 'paused' });
      await topicModel.updateStatus(taskIds[index], topicId, 'canceled');
    });

    await expect(service.close(graph.goal.id, 'canceled')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    const stopped = (await taskModel.findByIds(taskIds)).filter(
      (task) => task.status !== 'running',
    );
    expect(stopped).toHaveLength(1);
    expect(stopped[0].status).toBe('backlog');
  });

  describe('closing a goal with a main Agent turn in flight', () => {
    const managedGoal = async (title: string) => {
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({ tasks: ['Managed'], title });
      await new AgentOperationModel(serverDB, userId).recordStart({
        operationId: `op-manager-${title}`,
      });
      await serverDB
        .update(goals)
        .set({
          config: {
            ...graph.goal.config,
            manager: {},
            managerState: {
              operationId: `op-manager-${title}`,
              startedAt: new Date().toISOString(),
              token: 'turn',
              topicId: 'management-topic',
              turns: 1,
            },
          } as never,
        })
        .where(eq(goals.id, graph.goal.id));
      return { goalId: graph.goal.id, service };
    };

    it('interrupts the main Agent turn before ending the goal', async () => {
      // The coordinator's own operation is not a graph Task topic, so the
      // topic scan alone would leave it spending after the goal ended.
      const { goalId, service } = await managedGoal('interrupted');
      const interrupt = vi
        .spyOn(AiAgentService.prototype, 'interruptTask')
        .mockResolvedValue({ success: true } as never);

      expect((await service.close(goalId, 'achieved')).status).toBe('achieved');
      expect(interrupt).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'op-manager-interrupted' }),
      );
    });

    it('refuses to end the goal when the interruption is not confirmed', async () => {
      const { goalId, service } = await managedGoal('unconfirmed');
      vi.spyOn(AiAgentService.prototype, 'interruptTask').mockResolvedValue({
        deviceCancellationConfirmed: false,
        success: true,
      } as never);

      await expect(service.close(goalId, 'canceled')).rejects.toThrow(/not closed/);
      // Still fenced so nothing new starts, but not claimed as ended.
      expect((await new GoalModel(serverDB, userId).findById(goalId))?.status).toBe('paused');
    });
  });

  it('restarts a split-role goal under a new executor without replacing its supervisor', async () => {
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockResolvedValue();
    await serverDB.insert(agents).values([
      { id: 'agt_lead', slug: 'agt-lead', userId },
      { id: 'agt_first_worker', slug: 'agt-first-worker', userId },
      { id: 'agt_second_worker', slug: 'agt-second-worker', userId },
    ]);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      agentId: 'agt_lead',
      config: { taskAgentId: 'agt_first_worker' },
      tasks: ['Stuck task'],
      title: 'Restart split roles',
    });
    const created = await service.tick(graph.goal.id);

    const result = await service.restart(graph.goal.id, { agentId: 'agt_second_worker' });

    expect(result.goal.agentId).toBe('agt_lead');
    expect(result.goal.config?.taskAgentId).toBe('agt_second_worker');
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_second_worker');
  });

  it('cancels the failure gate a restart supersedes so the goal starts moving again', async () => {
    // A restarted task's pending recovery gate is answered by the restart
    // itself. Left pending, it keeps winning the coordinator's
    // pending-decision branch and the goal sits waiting_human with every task
    // freshly reset.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Risky task'], title: 'Restart clears gate' });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });
    expect((await service.tick(graph.goal.id)).outcome).toBe('waiting_human');

    const result = await service.restart(graph.goal.id);

    expect(result.restartedTaskIds).toEqual([created.taskId]);
    const after = await service.graph(graph.goal.id);
    expect(after.decisions[0].status).toBe('canceled');
    // The freed coordinator dispatches the reset task instead of re-parking.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const next = await service.tick(graph.goal.id);
    expect(next.outcome).not.toBe('waiting_human');
  });

  it('retires a stray node only together with the unfinished tasks depending on it', async () => {
    // A duplicated plan branch never gets a Task, so nothing else ever closes it
    // and the goal can never reach acceptance.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['First', 'Second', 'Keep'], title: 'Duplicates' });
    const [first, second, keep] = ['First', 'Second', 'Keep'].map((title) =>
      graph.nodes.find((node) => node.kind === 'task' && node.title === title)!,
    );
    await service.addEdge(graph.goal.id, second.id, first.id, 'depends_on');

    await expect(service.retireNodes(graph.goal.id, [first.id])).rejects.toThrow(second.id);

    const result = await service.retireNodes(graph.goal.id, [first.id, second.id], 'duplicate');

    expect(result.retiredNodeIds.sort()).toEqual([first.id, second.id].sort());
    const after = await service.graph(graph.goal.id);
    const status = (id: string) => after.nodes.find((node) => node.id === id)?.status;
    expect(status(first.id)).toBe('retired');
    expect(status(second.id)).toBe('retired');
    expect(status(keep.id)).not.toBe('retired');
  });

  it('retiring a dispatched node cancels its task and the gate parking the goal', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Canceled elsewhere'], title: 'Stray gate' });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Task canceled' });
    expect((await service.tick(graph.goal.id)).outcome).toBe('waiting_human');

    await service.retireNodes(graph.goal.id, [created.nodeId!]);

    expect((await taskModel.findById(created.taskId!))?.status).toBe('canceled');
    const after = await service.graph(graph.goal.id);
    expect(after.decisions[0].status).toBe('canceled');
    expect(after.goal.status).toBe('running');
  });

  it('retiring a node fences it against a coordinator still creating its task', async () => {
    const service = new GoalService(serverDB, userId);
    const graphModel = new GoalGraphModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Stray', 'Keep'], title: 'Retire race' });
    const stray = graph.nodes.find((node) => node.kind === 'task' && node.title === 'Stray')!;
    // A tick has claimed the node and is creating its Task when retirement lands.
    expect(await graphModel.claimTaskNode(graph.goal.id, stray.id, new Date(0))).toBeDefined();

    await service.retireNodes(graph.goal.id, [stray.id]);

    const lateTask = await new TaskModel(serverDB, userId).create({ instruction: 'Late' });
    expect(await graphModel.bindTask(graph.goal.id, stray.id, lateTask.id)).toBeUndefined();
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.find((node) => node.id === stray.id)?.status).toBe('retired');
  });

  it("stops a colleague's private task when a workspace owner retires its node", async () => {
    // The coordinator runs as the goal's owner, so its Tasks can be private to
    // that colleague. An owner retiring the node must still stop them — reads
    // under the owner's own visibility would silently miss them.
    const workspaceId = 'goal-retire-private-ws';
    const ownerId = 'goal-retire-private-owner';
    await serverDB.insert(users).values({ id: ownerId }).onConflictDoNothing();
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: workspaceId, primaryOwnerId: ownerId, slug: workspaceId })
      .onConflictDoNothing();
    const colleague = new GoalService(serverDB, userId, workspaceId);
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const graph = await colleague.create({ tasks: ['Private', 'Keep'], title: 'Private retire' });
    const created = await colleague.tick(graph.goal.id);
    await serverDB
      .update(tasks)
      .set({ status: 'running', visibility: 'private' })
      .where(eq(tasks.id, created.taskId!));
    expect(
      await new TaskModel(serverDB, ownerId, workspaceId).findById(created.taskId!),
    ).toBeFalsy();

    await new GoalService(serverDB, ownerId, workspaceId).retireNodes(graph.goal.id, [
      created.nodeId!,
    ]);

    const [task] = await serverDB.select().from(tasks).where(eq(tasks.id, created.taskId!));
    expect(task.status).toBe('canceled');
  });

  it('cancels a running task before looking for its runs, fencing a run still being dispatched', async () => {
    // A runner that already flipped the Task to `running` but has not recorded
    // its topic yet is invisible to the run lookup. It checks the Task's status
    // under the row lock before recording, so the cancellation must already be
    // committed by the time retirement looks for runs to stop.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Dispatching', 'Keep'], title: 'Fence runs' });
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'running');
    const statusAtLookup: (string | undefined)[] = [];
    const original = TaskTopicModel.prototype.findRunningByTaskIds;
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockImplementation(async function (
      this: TaskTopicModel,
      ids: string[],
    ) {
      statusAtLookup.push((await taskModel.findById(created.taskId!))?.status);
      return original.call(this, ids);
    });

    await service.retireNodes(graph.goal.id, [created.nodeId!]);

    expect(statusAtLookup).toEqual(['canceled']);
    expect((await taskModel.findById(created.taskId!))?.status).toBe('canceled');
  });

  it('lets an interrupted retirement be finished by retrying it', async () => {
    // The fence lands before the run is stopped; when stopping it cannot be
    // confirmed the call fails with the node already retired. A retry must
    // still stop the task instead of rejecting the node as terminal.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Running', 'Keep'], title: 'Retry retire' });
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const created = await service.tick(graph.goal.id);
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockResolvedValue([
      { taskId: created.taskId!, topicId: 'tpc_running' },
    ] as never);
    const cancelTopic = vi
      .spyOn(TaskService.prototype, 'cancelTopic')
      .mockRejectedValueOnce(new Error('interrupt not confirmed'))
      .mockResolvedValue(undefined as never);

    await expect(service.retireNodes(graph.goal.id, [created.nodeId!])).rejects.toThrow(
      'interrupt not confirmed',
    );
    expect(
      (await service.graph(graph.goal.id)).nodes.find((node) => node.id === created.nodeId)?.status,
    ).toBe('retired');

    const retried = await service.retireNodes(graph.goal.id, [created.nodeId!]);

    expect(retried.retiredNodeIds).toEqual([created.nodeId]);
    expect(cancelTopic).toHaveBeenCalledTimes(2);
    expect((await taskModel.findById(created.taskId!))?.status).toBe('canceled');
  });

  it('discards a stale tick outcome for a node retired while it ran', async () => {
    const service = new GoalService(serverDB, userId);
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const graph = await service.create({ tasks: ['Stray', 'Keep'], title: 'Stale tick' });
    const created = await service.tick(graph.goal.id);
    // The coordinator loaded this snapshot before the retirement landed.
    const stale = await service.graph(graph.goal.id);
    await service.retireNodes(graph.goal.id, [created.nodeId!]);

    const result = await (service as any).consumeCompletedTask(
      stale,
      created.nodeId!,
      created.taskId!,
    );

    expect(result.outcome).toBe('no_progress');
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.find((node) => node.id === created.nodeId)?.status).toBe('retired');
    expect(after.nodes.some((node) => node.kind === 'finding')).toBe(false);
  });

  it('reopens a goal parked by no_frontier once the blocking nodes are retired', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['A', 'B', 'Keep'], title: 'Deadlocked branch' });
    const [a, b] = ['A', 'B'].map((title) =>
      graph.nodes.find((node) => node.kind === 'task' && node.title === title)!,
    );
    const graphModel = new GoalGraphModel(serverDB, userId);
    await graphModel.createEdge(graph.goal.id, a.id, b.id, 'depends_on');
    await graphModel.createEdge(graph.goal.id, b.id, a.id, 'depends_on');
    const keep = graph.nodes.find((node) => node.kind === 'task' && node.title === 'Keep')!;
    await graphModel.updateNodeStatus(graph.goal.id, keep.id, 'resolved');
    await service.tick(graph.goal.id); // deadlock → no_frontier → paused
    expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');

    await service.retireNodes(graph.goal.id, [a.id, b.id]);

    expect((await service.graph(graph.goal.id)).goal.status).toBe('running');
  });

  it('leaves a user-paused goal paused when nodes are retired', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['A', 'B'], title: 'Paused by a person' });
    const [a, b] = graph.nodes.filter((node) => node.kind === 'task');
    const graphModel = new GoalGraphModel(serverDB, userId);
    await graphModel.createEdge(graph.goal.id, a.id, b.id, 'depends_on');
    await graphModel.createEdge(graph.goal.id, b.id, a.id, 'depends_on');
    await service.tick(graph.goal.id); // no_frontier park
    await service.pause(graph.goal.id); // the person takes the pause over

    await service.retireNodes(graph.goal.id, [a.id, b.id]);

    expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');
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

  it('attaches seed tasks straight to the problem instead of wrapping each in an experiment', async () => {
    // An experiment is a candidate answer under test. A caller-supplied seed is
    // ordinary work, so it takes the same shape as a planned or manager-submitted
    // Task: a `decomposes` edge from the problem, no answer container.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Question', tasks: ['Seed work'] });
    const question = graph.nodes.find((n) => n.kind === 'problem')!;
    const task = graph.nodes.find((n) => n.kind === 'task')!;
    expect(graph.goal.config?.exploration).toBeUndefined();
    expect(graph.nodes.filter((n) => n.kind === 'experiment')).toHaveLength(0);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        kind: 'decomposes',
        sourceNodeId: question.id,
        targetNodeId: task.id,
      }),
    ]);
  });

  it('seeds the exploration baseline inside an experiment container', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { exploration: { instruction: 'Compare evidence', maxExperiments: 3 } },
      title: 'Explore',
    });
    const question = graph.nodes.find((n) => n.kind === 'problem')!;
    const answer = graph.nodes.find((n) => n.kind === 'experiment')!;
    const task = graph.nodes.find((n) => n.kind === 'task')!;
    expect(answer.taskId).toBeNull();
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'answers',
          sourceNodeId: answer.id,
          targetNodeId: question.id,
        }),
        expect.objectContaining({
          kind: 'contains',
          sourceNodeId: answer.id,
          targetNodeId: task.id,
        }),
      ]),
    );
  });

  it('plans the decomposition when a goal has no tasks yet', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '核心问题的一句话陈述',
      tasks: [
        { dependsOn: [], hypothesis: null, instruction: '收集原始材料', title: '方向A:收集' },
        {
          dependsOn: [0],
          hypothesis: '按模块聚类比按时间排序更能暴露根因',
          instruction: '分析并综合结论',
          title: '方向B:分析',
        },
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
    const problem = after.nodes.find((n) => n.kind === 'problem')!;
    expect(problem.description).toBe('核心问题的一句话陈述');

    // Only the direction the planner marked as a hypothesis becomes a candidate
    // answer: one experiment answering the problem and containing that Task.
    // The certain steps attach straight to the problem.
    const byTitle = new Map(after.nodes.map((n) => [n.title, n.id]));
    const experiments = after.nodes.filter((n) => n.kind === 'experiment');
    expect(experiments).toHaveLength(1);
    expect(experiments[0]).toMatchObject({
      description: '按模块聚类比按时间排序更能暴露根因',
      title: '方向B:分析',
    });
    expect(after.edges.filter((e) => e.kind === 'answers')).toEqual([
      expect.objectContaining({ sourceNodeId: experiments[0].id, targetNodeId: problem.id }),
    ]);
    expect(after.edges.filter((e) => e.kind === 'contains')).toEqual([
      expect.objectContaining({
        sourceNodeId: experiments[0].id,
        targetNodeId: byTitle.get('方向B:分析'),
      }),
    ]);
    expect(
      after.edges
        .filter((e) => e.kind === 'decomposes' && e.sourceNodeId === problem.id)
        .map((e) => e.targetNodeId)
        .sort(),
    ).toEqual([byTitle.get('方向A:收集'), byTitle.get('方向C:汇编')].sort());

    // The planner's dependsOn indices become depends_on edges, dependent →
    // prerequisite; the self and forward references were dropped.
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

  it('plans a goal without hypotheses as plain tasks under the problem', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '修好最近三天的 bug',
      tasks: [
        { dependsOn: [], hypothesis: null, instruction: '列出 issue', title: '建立清单' },
        { dependsOn: [0], hypothesis: null, instruction: '逐项修复', title: '实施修复' },
      ],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Bug sweep' });

    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');

    const after = await service.graph(graph.goal.id);
    const problem = after.nodes.find((n) => n.kind === 'problem')!;
    const taskIds = after.nodes.filter((n) => n.kind === 'task').map((n) => n.id);
    expect(taskIds).toHaveLength(2);
    expect(after.nodes.filter((n) => n.kind === 'experiment')).toHaveLength(0);
    expect(after.edges.filter((e) => e.kind === 'answers' || e.kind === 'contains')).toHaveLength(
      0,
    );
    expect(
      after.edges
        .filter((e) => e.kind === 'decomposes' && e.sourceNodeId === problem.id)
        .map((e) => e.targetNodeId)
        .sort(),
    ).toEqual([...taskIds].sort());
    expect(after.edges.filter((e) => e.kind === 'depends_on')).toHaveLength(1);
  });

  it('collapses a repeated mould into one batch, materializing only the probes', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 50 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 50,
        units: Array.from({ length: 50 }, (_, i) => `Unit ${i + 1}`),
        variants: [],
      },
      tasks: Array.from({ length: 5 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Migrate stores' });

    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');

    const after = await service.graph(graph.goal.id);
    // ① Only the K probes exist as Tasks — the whole 50-unit fan-out never lands.
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(5);
    expect(after.nodes.filter((n) => n.kind === 'batch')).toHaveLength(1);
    expect(after.nodes.filter((n) => n.kind === 'finding')).toHaveLength(1);
    expect(after.nodes.filter((n) => n.kind === 'decision')).toHaveLength(1);

    const state = after.goal.config?.rolloutState;
    expect(state?.phase).toBe('probe');
    expect(state?.probeNodeIds).toHaveLength(5);
    expect(state?.unitTitles).toHaveLength(50);
    expect(after.goal.config?.rollout?.trigger).toBe('canary');

    // The probes are contained by the batch; the gate waits on each of them.
    const batch = after.nodes.find((n) => n.kind === 'batch')!;
    const containedIds = new Set(
      after.edges
        .filter((e) => e.kind === 'contains' && e.sourceNodeId === batch.id)
        .map((e) => e.targetNodeId),
    );
    // Five probes inside the batch — never the whole 50-unit roster.
    expect(after.nodes.filter((n) => containedIds.has(n.id) && n.kind === 'task')).toHaveLength(5);
    // Plus the one Template and the one Assay that make the batch a batch.
    expect(after.nodes.filter((n) => containedIds.has(n.id) && n.kind === 'finding')).toHaveLength(
      1,
    );
    expect(after.nodes.filter((n) => containedIds.has(n.id) && n.kind === 'decision')).toHaveLength(
      1,
    );
  });

  it('does not grow a batch for a goal that is not one repeated mould', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '分两步上线一个新功能',
      rollout: {
        recipeOutline: '',
        repeatable: false,
        unitCount: 3,
        units: [],
        variants: [],
      },
      tasks: [
        { dependsOn: [], instruction: '第一步：加 schema', title: '第一步' },
        { dependsOn: [0], instruction: '第二步：接 UI', title: '第二步' },
      ],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Ship a feature' });

    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');

    const after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'batch')).toHaveLength(0);
    expect(after.goal.config?.rolloutState).toBeUndefined();
    // The ordinary decomposition is untouched: both steps are plain tasks.
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(2);
  });

  it('restarts the canary loop when a person answers a broken batch gate', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 50 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 50,
        units: Array.from({ length: 50 }, (_, i) => `Unit ${i + 1}`),
        variants: [],
      },
      tasks: Array.from({ length: 5 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Migrate stores' });
    await service.tick(graph.goal.id);

    const graphModel = new GoalGraphModel(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const before = await service.graph(graph.goal.id);
    const state = before.goal.config!.rolloutState!;
    const assayId = state.assayNodeId!;

    // Simulate the break the coordinator opens when a gate blocks.
    const decision = await graphModel.createDecision(graph.goal.id, assayId, {
      authority: 'user',
      options: [
        { description: '修订配方', id: 'revise', label: '修订配方并重探' },
        { description: '新类型', id: 'new_class', label: '作为新类型并排处理' },
      ],
      question: 'Batch gate blocked',
      requestedUserId: userId,
    });
    await graphModel.updateNodeStatus(graph.goal.id, assayId, 'waiting');
    await goalModel.updateRolloutState(graph.goal.id, { ...state, phase: 'pattern_break' });
    await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));

    // R5: the answer itself restarts the loop — no manual rerun.
    await service.decide(graph.goal.id, decision!.id, 'revise', '补上 SSR 播种这一步');

    const after = await service.graph(graph.goal.id);
    const next = after.goal.config!.rolloutState!;
    expect(next.phase).toBe('probe');
    expect(next.waveIndex).toBe(0);
    expect(next.templateRevision).toBe(state.templateRevision + 1);
    expect(
      after.edges.some((e) => e.kind === 'revises' && e.sourceNodeId === next.templateNodeId),
    ).toBe(true);
    // A fresh gate and a fresh probe batch: the class is proved again.
    expect(next.assayNodeId).not.toBe(assayId);
    expect(next.probeNodeIds.length).toBeGreaterThan(0);
  });

  it('re-opens the broken unit as a new task when the canary loop restarts', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 50 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 50,
        units: Array.from({ length: 50 }, (_, i) => `Unit ${i + 1}`),
        variants: [],
      },
      tasks: Array.from({ length: 5 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Migrate stores' });
    await service.tick(graph.goal.id);

    const graphModel = new GoalGraphModel(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const before = await service.graph(graph.goal.id);
    const state = before.goal.config!.rolloutState!;
    const [broken, ...settled] = state.probeNodeIds;
    for (const id of settled) await graphModel.updateNodeStatus(graph.goal.id, id, 'resolved');
    await graphModel.updateNodeStatus(graph.goal.id, broken, 'waiting');

    const decision = await graphModel.createDecision(graph.goal.id, state.assayNodeId!, {
      authority: 'user',
      options: [
        { description: '修订配方', id: 'revise', label: '修订配方并重探' },
        { description: '新类型', id: 'new_class', label: '作为新类型并排处理' },
      ],
      question: 'Unit 1 did not pass',
      requestedUserId: userId,
    });
    await graphModel.updateNodeStatus(graph.goal.id, state.assayNodeId!, 'waiting');
    await goalModel.updateRolloutState(graph.goal.id, { ...state, phase: 'pattern_break' });
    await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));

    await service.decide(graph.goal.id, decision!.id, 'revise', '补上冷启动这一步');

    const after = await service.graph(graph.goal.id);
    const next = after.goal.config!.rolloutState!;
    // Decision #4: the broken unit runs again as a new task, the old one retires.
    expect(after.nodes.find((n) => n.id === broken)?.status).toBe('retired');
    expect(next.probeNodeIds).toHaveLength(1);
    const reopened = after.nodes.find((n) => n.id === next.probeNodeIds[0])!;
    expect(reopened.title).toBe('Unit 1');
    expect(
      after.edges.some(
        (e) =>
          e.kind === 'derived_from' && e.sourceNodeId === reopened.id && e.targetNodeId === broken,
      ),
    ).toBe(true);
    // Re-opening is not a new release: the roster cursor stays where it was.
    expect(next.releasedCount).toBe(state.releasedCount);
  });

  it('asks a blocking question before planning, then plans once with the answer', async () => {
    const planner = vi
      .spyOn(GoalCriteriaGeneratorService.prototype, 'decompose')
      .mockResolvedValue({
        assumptions: ['报告用中文'],
        problemStatement: '为新功能写一份发布说明',
        questions: [
          {
            assumption: '面向终端用户',
            blocking: true,
            impact: '决定写产品说明还是 API 变更',
            options: ['终端用户', '开发者'],
            question: '这份说明给谁看？',
          },
        ],
        tasks: [{ dependsOn: [], hypothesis: null, instruction: '写说明', title: '撰写' }],
      });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Release notes' });

    // The first plan asks instead of creating Tasks on a guess.
    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');
    let after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(0);
    const problem = after.nodes.find((n) => n.kind === 'problem')!;
    expect(Number(problem.confidence)).toBe(0.3);
    expect(after.goal.config?.understanding).toMatchObject({
      assumptions: ['报告用中文'],
      level: 'low',
    });
    const [decision] = after.decisions;
    expect(decision).toMatchObject({ question: '这份说明给谁看？', status: 'pending' });
    expect(decision.options?.map((option) => option.id)).toEqual([
      'option-1',
      'option-2',
      'assume',
      'answer',
    ]);
    expect(after.edges).toContainEqual(
      expect.objectContaining({
        kind: 'leads_to',
        sourceNodeId: problem.id,
        targetNodeId: decision.nodeId,
      }),
    );

    // The open question parks the goal on the ordinary decision gate.
    expect((await service.tick(graph.goal.id)).outcome).toBe('waiting_human');
    expect((await service.graph(graph.goal.id)).goal.status).toBe('review');

    // An empty free-text answer is refused rather than re-planning on nothing.
    await expect(service.decide(graph.goal.id, decision.id, 'answer', '  ')).rejects.toThrow(
      'This answer needs a note',
    );
    await service.decide(graph.goal.id, decision.id, 'option-2', '只关心 SDK');

    // The re-plan receives the answer and, even though the planner still
    // reports a blocking question, proceeds on assumptions: one round only.
    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');
    expect(planner).toHaveBeenLastCalledWith({
      clarifications: [{ answer: '开发者 (只关心 SDK)', question: '这份说明给谁看？' }],
      requirement: expect.any(String),
    });
    after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'task').map((n) => n.title)).toEqual(['撰写']);
    expect(after.decisions.filter((d) => d.status === 'pending')).toHaveLength(0);
    expect(Number(after.nodes.find((n) => n.kind === 'problem')!.confidence)).toBe(0.6);
    // The re-asked question was answered, so its fallback never becomes an
    // assumption that contradicts the answer.
    expect(after.goal.config?.understanding).toMatchObject({
      assumptions: ['报告用中文'],
      level: 'medium',
    });
  });

  it('lists a clarification round for other surfaces and answers it in one go', async () => {
    const planner = vi
      .spyOn(GoalCriteriaGeneratorService.prototype, 'decompose')
      .mockResolvedValue({
        assumptions: [],
        problemStatement: '写发布说明',
        questions: [
          {
            assumption: '终端用户',
            blocking: true,
            impact: '决定语气',
            options: ['终端用户', '开发者'],
            question: '给谁看？',
          },
          { assumption: '更新日志', blocking: true, options: [], question: '发在哪里？' },
        ],
        tasks: [{ dependsOn: [], hypothesis: null, instruction: '写', title: '撰写' }],
      });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      requirement: '为新功能写一份发布说明',
      title: 'Release notes',
    });
    await service.tick(graph.goal.id);

    const pending = await service.pendingClarifications();
    expect(pending).toEqual([
      expect.objectContaining({
        goalId: graph.goal.id,
        questions: expect.arrayContaining([
          expect.objectContaining({ description: '决定语气', question: '给谁看？' }),
          expect.objectContaining({ description: null, question: '发在哪里？' }),
        ]),
        // The requirement says which goal this is away from its own page.
        requirement: '为新功能写一份发布说明',
        title: 'Release notes',
      }),
    ]);

    // A paused goal keeps its questions but stops asking them elsewhere.
    await service.pause(graph.goal.id);
    expect(await service.pendingClarifications()).toEqual([]);
    await service.resume(graph.goal.id);
    expect(await service.pendingClarifications()).toHaveLength(1);

    const audience = pending[0].questions.find((q) => q.question === '给谁看？')!;
    const place = pending[0].questions.find((q) => q.question === '发在哪里？')!;
    await service.answerClarifications(graph.goal.id, [
      { decisionId: audience.decisionId, optionId: 'option-2', resolution: '只关心 SDK' },
      { decisionId: place.decisionId, optionId: 'answer', resolution: 'GitHub Release' },
    ]);

    expect(await service.pendingClarifications()).toEqual([]);
    expect((await service.graph(graph.goal.id)).goal.status).toBe('running');
    // One re-plan, carrying both answers.
    await service.tick(graph.goal.id);
    const [lastCall] = planner.mock.calls.at(-1)!;
    expect(lastCall.clarifications).toHaveLength(2);
    expect(lastCall.clarifications).toEqual(
      expect.arrayContaining([
        { answer: '开发者 (只关心 SDK)', question: '给谁看？' },
        { answer: 'GitHub Release', question: '发在哪里？' },
      ]),
    );
  });

  it('writes none of a clarification round when one answer is invalid, and retries cleanly', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      assumptions: [],
      problemStatement: '写发布说明',
      questions: [
        {
          assumption: '终端用户',
          blocking: true,
          options: ['终端用户', '开发者'],
          question: '给谁看？',
        },
        { assumption: '更新日志', blocking: true, options: [], question: '发在哪里？' },
      ],
      tasks: [{ dependsOn: [], hypothesis: null, instruction: '写', title: '撰写' }],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Release notes' });
    await service.tick(graph.goal.id);
    const [{ questions }] = await service.pendingClarifications();
    const audience = questions.find((q) => q.question === '给谁看？')!;
    const place = questions.find((q) => q.question === '发在哪里？')!;

    // The second answer is invalid, so the first must not be written either.
    await expect(
      service.answerClarifications(graph.goal.id, [
        { decisionId: audience.decisionId, optionId: 'option-2' },
        { decisionId: place.decisionId, optionId: 'no-such-option' },
      ]),
    ).rejects.toThrow('Unknown decision option');
    expect((await service.pendingClarifications())[0].questions).toHaveLength(2);

    // A retry after a partial write succeeds: the recorded answer is skipped.
    await service.decide(graph.goal.id, audience.decisionId, 'option-2');
    await service.answerClarifications(graph.goal.id, [
      { decisionId: audience.decisionId, optionId: 'option-2' },
      { decisionId: place.decisionId, optionId: 'assume' },
    ]);
    expect(await service.pendingClarifications()).toEqual([]);
  });

  it('keeps the answers in the fallback task when the re-plan fails', async () => {
    const planner = vi
      .spyOn(GoalCriteriaGeneratorService.prototype, 'decompose')
      .mockResolvedValue({
        assumptions: [],
        problemStatement: '写发布说明',
        questions: [
          {
            assumption: '终端用户',
            blocking: true,
            options: ['终端用户', '开发者'],
            question: '给谁看？',
          },
        ],
        tasks: [{ dependsOn: [], hypothesis: null, instruction: '写', title: '撰写' }],
      });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      problemDescription: '写一份发布说明，必须附上迁移指南',
      requirement: '写一份发布说明，必须附上迁移指南',
      title: 'Release notes',
    });
    await service.tick(graph.goal.id);
    // Asking commits no tasks, so the user's own words stay on the problem.
    expect(
      (await service.graph(graph.goal.id)).nodes.find((n) => n.kind === 'problem')!.description,
    ).toBe('写一份发布说明，必须附上迁移指南');
    const [{ questions }] = await service.pendingClarifications();
    await service.answerClarifications(graph.goal.id, [
      { decisionId: questions[0].decisionId, optionId: 'option-2', resolution: '只关心 SDK' },
    ]);

    planner.mockRejectedValueOnce(new Error('planner down'));
    await service.tick(graph.goal.id);

    const task = (await service.graph(graph.goal.id)).nodes.find((n) => n.kind === 'task');
    // The original request's constraint survives, not the planner's summary.
    expect(task!.description).toContain('必须附上迁移指南');
    expect(task!.description).toContain('Q: 给谁看？');
    expect(task!.description).toContain('A: 开发者 (只关心 SDK)');
  });

  it('keeps the coordinator understanding when the user edits the goal policy', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      assumptions: ['只修 P0'],
      problemStatement: '修 bug',
      questions: [],
      tasks: [{ dependsOn: [], hypothesis: null, instruction: '修', title: '修复' }],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Fix' });
    await service.tick(graph.goal.id);

    // A policy editor sends its whole (stale) config snapshot back.
    await new GoalModel(serverDB, userId).update(graph.goal.id, {
      config: { maxConcurrentTasks: 2 },
    });

    const after = await service.graph(graph.goal.id);
    expect(after.goal.config?.maxConcurrentTasks).toBe(2);
    expect(after.goal.config?.understanding).toMatchObject({
      assumptions: ['只修 P0'],
      level: 'medium',
    });
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
    expect(task?.instruction).toContain(
      'missing or broken capabilities within its scope are work to implement or repair',
    );
    expect(task?.instruction).toContain(
      'resolve the prerequisite before repeating the same checks',
    );
    expect(task?.instruction).toContain(
      'For an investigation-only Task, deliver supported findings',
    );
    expect(task?.instruction).toContain('do not silently expand into implementation');
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

  /**
   * Regression: the terminal acceptance hung only off the problem node, so it
   * rendered beside the first round instead of after the work it closes.
   */
  it('builds the Goal-level Acceptance Task on the delivered leaf Tasks', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'Return two verified supplier quotes.',
      title: 'Find two supplier quotes',
      tasks: ['Research supplier A', 'Research supplier B'],
    });

    let acceptance;
    for (let i = 0; i < 12 && !acceptance; i++) {
      await service.tick(graph.goal.id);
      const current = await service.graph(graph.goal.id);
      for (const node of current.nodes) {
        if (node.taskId && node.title !== 'Complete full Goal acceptance')
          await taskModel.updateStatus(node.taskId, 'completed');
      }
      acceptance = current.nodes.find((node) => node.title === 'Complete full Goal acceptance');
    }

    const current = await service.graph(graph.goal.id);
    const leaves = current.nodes
      .filter((node) => node.title.startsWith('Research supplier'))
      .map((node) => node.id);
    expect(acceptance).toBeTruthy();
    expect(
      current.edges
        .filter((edge) => edge.kind === 'depends_on' && edge.sourceNodeId === acceptance!.id)
        .map((edge) => edge.targetNodeId)
        .sort(),
    ).toEqual(leaves.sort());
  });

  /**
   * Regression: the acceptance node and its dependency edges were written in
   * separate transactions. A failure between them left the node without its
   * links for good, because once the node exists no later tick writes them.
   */
  it('creates the Goal-level Acceptance Task and its dependencies atomically', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'Return two verified supplier quotes.',
      title: 'Atomic acceptance links',
      tasks: ['Research supplier A', 'Research supplier B'],
    });
    const findAcceptance = async () =>
      (await service.graph(graph.goal.id)).nodes.find(
        (node) => node.title === 'Complete full Goal acceptance',
      );

    let interrupted = false;
    for (let i = 0; i < 14 && !(await findAcceptance()); i++) {
      const tasks = (await service.graph(graph.goal.id)).nodes.filter(
        (node) => node.kind === 'task',
      );
      if (!interrupted && tasks.length > 0 && tasks.every((node) => node.status === 'resolved')) {
        // Every Task is delivered, so this tick creates the acceptance. Fail it
        // after the node insert and before its dependency edges are written.
        const spy = vi.spyOn(goalGraphUtils, 'experimentOwner').mockImplementation(() => {
          throw new Error('interrupted while linking the acceptance');
        });
        await service.tick(graph.goal.id).catch(() => undefined);
        spy.mockRestore();
        interrupted = true;
        expect(await findAcceptance()).toBeUndefined();
        continue;
      }
      await service.tick(graph.goal.id);
      for (const node of (await service.graph(graph.goal.id)).nodes) {
        if (node.taskId && node.title !== 'Complete full Goal acceptance')
          await taskModel.updateStatus(node.taskId, 'completed');
      }
    }

    const current = await service.graph(graph.goal.id);
    const acceptance = current.nodes.find((node) => node.title === 'Complete full Goal acceptance');
    const leaves = current.nodes
      .filter((node) => node.title.startsWith('Research supplier'))
      .map((node) => node.id);
    expect(interrupted).toBe(true);
    expect(acceptance).toBeTruthy();
    expect(
      current.edges
        .filter((edge) => edge.kind === 'depends_on' && edge.sourceNodeId === acceptance!.id)
        .map((edge) => edge.targetNodeId)
        .sort(),
    ).toEqual(leaves.sort());
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
      config: {
        exploration: { instruction: 'Compare evidence', maxExperiments: 3 },
        recovery: { maxAttemptsPerTask: 3, maxStepsPerRun: 500 },
      },
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
    const afterRetry = await service.graph(graph.goal.id);
    expect(afterRetry.decisions).toHaveLength(0);
    expect(afterRetry.nodes.filter((node) => node.kind === 'task')).toEqual([
      expect.objectContaining({ id: created.nodeId, taskId: created.taskId }),
    ]);
    expect(afterRetry.edges.filter((edge) => edge.kind === 'derived_from')).toHaveLength(0);
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

  describe('a running topic whose run already ended', () => {
    const setup = async (title: string, operationId: string, completedAt: Date) => {
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({ operationId: 'op-next', success: true } as never);
      vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          operationId,
          topicId: `topic-${operationId}`,
        } as never,
      ]);
      const timeoutSpy = vi
        .spyOn(TaskTopicModel.prototype, 'updateStatus')
        .mockResolvedValue(undefined);

      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const graph = await service.create({
        config: { recovery: { maxAttemptsPerTask: 3, operationLeaseTimeoutMs: 60_000 } },
        title,
        tasks: ['Run a device experiment'],
      });
      const created = await service.tick(graph.goal.id);
      await taskModel.update(created.taskId!, { totalTopics: 1 });
      await taskModel.updateStatus(created.taskId!, 'running');

      // The gateway watchdog already settled the run as an error, but the task
      // lifecycle never heard about it, so the topic still reads `running`.
      const operationModel = new AgentOperationModel(serverDB, userId);
      await operationModel.recordStart({ operationId, taskId: created.taskId });
      await operationModel.recordCompletion(operationId, {
        completedAt,
        completionReason: 'error',
        status: 'error',
      });

      return { created, graph, runSpy, service, timeoutSpy };
    };

    it('reclaims it once the run has been over for longer than the lease', async () => {
      const { created, graph, runSpy, service, timeoutSpy } = await setup(
        'Recover a watchdog-abandoned run',
        'op-abandoned',
        new Date('2026-01-01T00:10:00.000Z'),
      );

      const recovered = await service.tick(graph.goal.id);

      expect(timeoutSpy).toHaveBeenCalledWith(created.taskId, 'topic-op-abandoned', 'timeout');
      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: created.taskId, trigger: 'goal' }),
      );
      expect(recovered).toMatchObject({
        message: expect.stringContaining('Recovered abandoned task'),
        outcome: 'waiting_external',
        taskId: created.taskId,
      });
    });

    it('leaves a run parked for a client alone however long it has waited', async () => {
      const { created, graph, runSpy, service, timeoutSpy } = await setup(
        'Wait for a local-model client',
        'op-waiting-client',
        new Date('2026-01-01T00:10:00.000Z'),
      );
      // Parked in waiting_for_client (U4c): resumable until its own expiry.
      await serverDB
        .update(agentOperations)
        .set({ completionReason: 'waiting_for_client', status: 'waiting_for_client' })
        .where(eq(agentOperations.id, 'op-waiting-client'));

      const waiting = await service.tick(graph.goal.id);

      expect(timeoutSpy).not.toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
      expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
    });

    it('leaves a run that just ended to its own completion hook', async () => {
      const { created, graph, runSpy, service, timeoutSpy } = await setup(
        'Wait for the completion hook',
        'op-just-ended',
        new Date(),
      );

      const waiting = await service.tick(graph.goal.id);

      expect(timeoutSpy).not.toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
      expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
    });
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

  it('offers retry, abandon and fail on a failed terminal acceptance; abandon cancels the Goal', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 1 } },
      requirement: 'Return three verified supplier quotes.',
      title: 'Abandoned terminal acceptance',
      tasks: ['Complete full Goal acceptance'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });
    await service.tick(graph.goal.id);
    const gated = await service.graph(graph.goal.id);

    expect(gated.decisions[0].options?.map((option) => option.id)).toEqual([
      'retry',
      'retire',
      'fail',
    ]);
    await service.decide(graph.goal.id, gated.decisions[0].id, 'retire');

    const after = await service.graph(graph.goal.id);
    expect(after.goal.status).toBe('canceled');
    expect(after.nodes.find((node) => node.taskId === created.taskId)?.status).toBe('retired');
  });

  it('reopens an achieved Goal when its owner requests changes, and reworks the acceptance', async () => {
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'A one-page onboarding checklist',
      title: 'Reworked delivery',
      tasks: ['Draft the checklist'],
    });
    const work = await service.tick(graph.goal.id);
    await taskModel.updateStatus(work.taskId!, 'completed');
    await service.tick(graph.goal.id);
    await service.tick(graph.goal.id);
    const acceptance = await service.tick(graph.goal.id);
    await taskModel.updateStatus(acceptance.taskId!, 'completed');
    await service.tick(graph.goal.id);
    expect((await service.tick(graph.goal.id)).outcome).toBe('achieved');

    const reopened = await service.reopenForChanges(acceptance.taskId!, 'Add a day-one agenda');

    expect(reopened).toBe(graph.goal.id);
    const after = await service.graph(graph.goal.id);
    expect(after.goal.status).toBe('running');
    expect(after.goal.completedAt).toBeNull();
    expect(after.goal.config?.changeRequest).toMatchObject({
      comment: 'Add a day-one agenda',
      taskId: acceptance.taskId,
    });
    expect(after.nodes.find((node) => node.taskId === acceptance.taskId)?.status).toBe('active');
    expect((await taskModel.findById(acceptance.taskId!))?.status).toBe('backlog');

    // The coordinator dispatches the rework instead of reading the Goal as done.
    const rework = await service.tick(graph.goal.id);
    expect(rework.message).toMatch(/^Started task /);
    expect(TaskRunnerService.prototype.runTask).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskId: acceptance.taskId }),
    );
  });

  it('does not reopen a Goal the owner already ended', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      requirement: 'A one-page onboarding checklist',
      title: 'Ended delivery',
      tasks: ['Complete full Goal acceptance'],
    });
    const created = await service.tick(graph.goal.id);
    await new GoalModel(serverDB, userId).updateStatus(graph.goal.id, 'canceled');

    expect(await service.reopenForChanges(created.taskId!, 'Too late')).toBeUndefined();
    expect((await service.graph(graph.goal.id)).goal.status).toBe('canceled');
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

  describe('a Task that could not reach its device', () => {
    const DEVICE_NOT_FOUND_HEADLINE =
      'The device this agent is bound to is no longer registered with the connection service. Reconnect the device, or bind this agent to another online device.';
    // A workspace goal whose agent runs on its owner's personal device: the
    // route the dispatch recorded names the personal pool, not the goal's.
    const route = { deviceId: 'device-laptop', userId: 'device-owner' };

    const setup = async (title: string) => {
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const graph = await service.create({
        config: { recovery: { maxAttemptsPerTask: 3 } },
        title,
        tasks: ['Reproduce on the bound device'],
      });
      const created = await service.tick(graph.goal.id);
      await taskModel.update(created.taskId!, { totalTopics: 1 });

      const operationModel = new AgentOperationModel(serverDB, userId);
      await operationModel.recordStart({ operationId: 'op-dispatch', taskId: created.taskId });
      await operationModel.recordCompletion('op-dispatch', {
        completedAt: new Date(),
        completionReason: 'error',
        error: { deviceRoute: route, message: DEVICE_NOT_FOUND_HEADLINE },
        status: 'error',
      });
      vi.spyOn(TaskTopicModel.prototype, 'findWithHandoff').mockResolvedValue([
        { operationId: 'op-dispatch' } as never,
      ]);

      await taskModel.updateStatus(created.taskId!, 'paused', {
        error: DEVICE_NOT_FOUND_HEADLINE,
      });
      return { created, graph, service, taskModel };
    };

    it('waits for the device instead of asking a person', async () => {
      const listSpy = vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([]);
      const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask');
      const { created, graph, service } = await setup('Device went to sleep');

      const waiting = await service.tick(graph.goal.id);

      expect(listSpy).toHaveBeenCalledWith('device-owner', undefined);
      expect(waiting).toMatchObject({
        message: expect.stringContaining('waiting for its device to reconnect'),
        outcome: 'waiting_external',
        taskId: created.taskId,
      });
      expect(runSpy).not.toHaveBeenCalled();
      expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
    });

    it('keeps waiting while only some other device is online', async () => {
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([
        { deviceId: 'device-desktop' } as never,
      ]);
      const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask');
      const { graph, service } = await setup('Another device is online');

      const waiting = await service.tick(graph.goal.id);

      expect(waiting).toMatchObject({ outcome: 'waiting_external' });
      expect(runSpy).not.toHaveBeenCalled();
    });

    it('retries on its own once its device is back online', async () => {
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([
        { deviceId: 'device-laptop' } as never,
      ]);
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({ operationId: 'op-after-reconnect', success: true } as never);
      const { created, graph, service } = await setup('Device reconnected');

      const retried = await service.tick(graph.goal.id);

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: created.taskId, trigger: 'goal' }),
      );
      expect(retried).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
      expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
    });

    it('keeps waiting when the retry itself cannot reach the device', async () => {
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([
        { deviceId: 'device-laptop' } as never,
      ]);
      vi.spyOn(TaskRunnerService.prototype, 'runTask').mockRejectedValue(
        new Error('DEVICE_OFFLINE (HTTP 503)'),
      );
      const { created, graph, service, taskModel } = await setup('Device flapping');

      const waiting = await service.tick(graph.goal.id);

      expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
      expect(await taskModel.findById(created.taskId!)).toMatchObject({
        error: 'DEVICE_OFFLINE (HTTP 503)',
        status: 'paused',
      });
      expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
    });

    it('retries on the offline schedule even while the device still looks offline', async () => {
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([]);
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({ operationId: 'op-on-schedule', success: true } as never);
      const { created, graph, service } = await setup('Device gone past the first backoff');
      await serverDB
        .update(tasks)
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where(eq(tasks.id, created.taskId!));

      const retried = await service.tick(graph.goal.id);

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: created.taskId, trigger: 'goal' }),
      );
      expect(retried).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
      expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
    });

    it('waits out the backoff without presence on a deployment without a device gateway', async () => {
      const listSpy = vi.spyOn(deviceGateway, 'queryDeviceList');
      const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask');
      const { created, graph, service } = await setup('Self-hosted without devices');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(false);

      const waiting = await service.tick(graph.goal.id);

      expect(listSpy).not.toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
      expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
    });
  });

  describe('a Task its usage window refused', () => {
    const SESSION_LIMIT = "You've hit your session limit · resets 4:30am";

    const setup = async (title: string, resetsAtMs: number) => {
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const graph = await service.create({
        config: { recovery: { maxAttemptsPerTask: 3 } },
        title,
        tasks: ['Run on the external Agent'],
      });
      const created = await service.tick(graph.goal.id);
      await taskModel.update(created.taskId!, { totalTopics: 1 });

      const operationModel = new AgentOperationModel(serverDB, userId);
      await operationModel.recordStart({ operationId: 'op-quota', taskId: created.taskId });
      await operationModel.recordCompletion('op-quota', {
        completedAt: new Date(),
        completionReason: 'error',
        error: {
          body: {
            code: 'rate_limit',
            rateLimitInfo: { resetsAt: Math.floor(resetsAtMs / 1000), status: 'rejected' },
          },
          category: 'quota',
          message: SESSION_LIMIT,
        },
        status: 'error',
      });
      vi.spyOn(TaskTopicModel.prototype, 'findWithHandoff').mockResolvedValue([
        { operationId: 'op-quota' } as never,
      ]);
      await taskModel.updateStatus(created.taskId!, 'paused', { error: SESSION_LIMIT });
      return { created, graph, service };
    };

    it('waits for the reset instead of asking a person', async () => {
      const schedule = vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
      const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask');
      const resetsAt = Date.now() + 2 * 60 * 60 * 1000;
      const { created, graph, service } = await setup('Session limit', resetsAt);

      const waiting = await service.tick(graph.goal.id);

      expect(waiting).toMatchObject({
        message: expect.stringContaining('usage window to reset'),
        outcome: 'waiting_external',
        taskId: created.taskId,
      });
      expect(schedule).toHaveBeenLastCalledWith(
        expect.objectContaining({ goalId: graph.goal.id, trigger: 'wake' }),
      );
      expect(schedule.mock.lastCall![0].delay).toBeGreaterThanOrEqual(2 * 60 * 60);

      // More ticks before the reset (the sweep, Task events) queue no more wakes,
      // and a policy edit from a stale snapshot does not drop the armed receipt.
      await service.tick(graph.goal.id);
      await new GoalModel(serverDB, userId).update(graph.goal.id, {
        config: { recovery: { maxAttemptsPerTask: 3 } },
      });
      expect((await service.graph(graph.goal.id)).goal.config?.quotaRetryWakeAt).toBeDefined();
      await service.tick(graph.goal.id);
      expect(schedule.mock.calls.filter(([params]) => params.trigger === 'wake')).toHaveLength(1);
      expect(runSpy).not.toHaveBeenCalled();
      const after = await service.graph(graph.goal.id);
      expect(after.decisions).toHaveLength(0);
      expect(after.goal.config?.supervisorState?.incidents ?? []).toHaveLength(0);
    });

    // The refusal's text names the limit, so its runs are uncharged and the
    // attempt budget cannot end a window that keeps refusing. The uncharged
    // quota schedule does: once spent, a person is asked instead of another wait.
    it('stops waiting once the uncharged usage-limit retries are spent', async () => {
      const schedule = vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
      const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask');
      const { created, graph, service } = await setup(
        'Session limit keeps refusing',
        Date.now() + 2 * 60 * 60 * 1000,
      );
      for (let seq = 1; seq <= MAX_QUOTA_RETRIES + 1; seq++) {
        const topicId = `tpc_quota_${seq}`;
        await serverDB.insert(topics).values({ id: topicId, userId });
        await serverDB.insert(taskTopics).values({
          seq,
          status: QUOTA_LIMITED_RUN_STATUS,
          taskId: created.taskId!,
          topicId,
          updatedAt: new Date(Date.now() - (MAX_QUOTA_RETRIES + 1 - seq) * 60 * 1000),
          userId,
        });
      }

      const gated = await service.tick(graph.goal.id);

      expect(gated).toMatchObject({ outcome: 'waiting_human', taskId: created.taskId });
      expect(runSpy).not.toHaveBeenCalled();
      expect(schedule.mock.calls.filter(([params]) => params.trigger === 'wake')).toHaveLength(0);
      expect((await service.graph(graph.goal.id)).decisions).toHaveLength(1);
    });

    it('retries through ordinary recovery once the window has reset', async () => {
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({ operationId: 'op-after-reset', success: true } as never);
      const { created, graph, service } = await setup(
        'Session limit over',
        Date.now() - 2 * 60 * 1000,
      );

      const retried = await service.tick(graph.goal.id);

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: created.taskId, trigger: 'goal' }),
      );
      expect(retried).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
      expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
    });

    it('does not start the retry once the Goal deadline has passed', async () => {
      const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask');
      const { graph, service } = await setup(
        'Reset after the deadline',
        Date.now() - 2 * 60 * 1000,
      );
      await serverDB
        .update(goals)
        .set({
          config: sql`jsonb_set(COALESCE(${goals.config}, '{}'::jsonb), '{schedule}', ${JSON.stringify({ deadline: new Date(Date.now() - 60_000).toISOString() })}::jsonb)`,
        })
        .where(eq(goals.id, graph.goal.id));

      await service.tick(graph.goal.id);

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe('a Task whose runs its device lost', () => {
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;

    const setup = async (title: string, maxAttemptsPerTask: number) => {
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([]);
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({ operationId: 'op-retry', success: true } as never);
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const graph = await service.create({
        config: { recovery: { maxAttemptsPerTask, operationLeaseTimeoutMs: 60_000 } },
        title,
        tasks: ['Run on the laptop'],
      });
      const created = await service.tick(graph.goal.id);
      runSpy.mockClear();
      return { created, graph, runSpy, service, taskModel };
    };

    const addRun = async (
      taskId: string,
      seq: number,
      status: string,
      options: { metadata?: ChatTopicMetadata; operationId?: string; updatedAt?: Date } = {},
    ) => {
      const topicId = `tpc_offline_${seq}`;
      await serverDB.insert(topics).values({ id: topicId, metadata: options.metadata, userId });
      await serverDB.insert(taskTopics).values({
        operationId: options.operationId,
        seq,
        status,
        taskId,
        topicId,
        userId,
        ...(options.updatedAt && { updatedAt: options.updatedAt }),
      });
      return topicId;
    };

    /** `count` consecutive offline runs, the newest `sinceLast` ago. */
    const addOfflineRuns = async (taskId: string, count: number, sinceLast: number) => {
      for (let seq = 1; seq <= count; seq++) {
        await addRun(taskId, seq, DEVICE_OFFLINE_RUN_STATUS, {
          updatedAt: new Date(Date.now() - sinceLast - (count - seq) * HOUR),
        });
      }
    };

    const decisionReasons = async (service: GoalService, goalId: string) =>
      (await service.graph(goalId)).nodes
        .filter((node) => node.kind === 'decision')
        .map((node) => node.description);

    it('does not charge a run lost while its device was offline to the attempt budget', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup(
        'Laptop went offline mid-run',
        1,
      );
      await taskModel.update(created.taskId!, { totalTopics: 1 });
      await taskModel.updateStatus(created.taskId!, 'running');
      const operationModel = new AgentOperationModel(serverDB, userId);
      await operationModel.recordStart({ operationId: 'op-lost', taskId: created.taskId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, 'op-lost'));
      const topicId = await addRun(created.taskId!, 1, 'running', {
        metadata: {
          runningOperation: {
            assistantMessageId: 'msg-lost',
            deviceId: 'device-laptop',
            operationId: 'op-lost',
          },
        },
        operationId: 'op-lost',
      });

      const waiting = await service.tick(graph.goal.id);

      expect(waiting).toMatchObject({
        message: expect.stringContaining('waiting for its device to reconnect'),
        outcome: 'waiting_external',
        taskId: created.taskId,
      });
      expect(runSpy).not.toHaveBeenCalled();
      expect(await decisionReasons(service, graph.goal.id)).toHaveLength(0);
      const [lost] = await new TaskTopicModel(serverDB, userId).findByTaskId(created.taskId!);
      expect(lost.status).toBe(DEVICE_OFFLINE_RUN_STATUS);

      // Once the first backoff has passed, the retry goes out on the budget the
      // lost run did not spend.
      await serverDB
        .update(taskTopics)
        .set({ updatedAt: new Date(Date.now() - 31 * MINUTE) })
        .where(eq(taskTopics.topicId, topicId));
      await service.tick(graph.goal.id);

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: created.taskId, trigger: 'goal' }),
      );
      expect(await decisionReasons(service, graph.goal.id)).toHaveLength(0);
    });

    it('still charges a lost run whose device is online when it is reclaimed', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup(
        'Run died on a connected laptop',
        1,
      );
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([
        { deviceId: 'device-laptop' } as never,
      ]);
      await taskModel.update(created.taskId!, { totalTopics: 1 });
      await taskModel.updateStatus(created.taskId!, 'running');
      const operationModel = new AgentOperationModel(serverDB, userId);
      await operationModel.recordStart({ operationId: 'op-died', taskId: created.taskId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, 'op-died'));
      await addRun(created.taskId!, 1, 'running', {
        metadata: { boundDeviceId: 'device-laptop' },
        operationId: 'op-died',
      });

      const gated = await service.tick(graph.goal.id);

      expect(gated).toMatchObject({ outcome: 'waiting_human', taskId: created.taskId });
      expect(runSpy).not.toHaveBeenCalled();
    });

    it.each([
      { before: 29 * MINUTE, after: 31 * MINUTE, offlineRuns: 1, schedule: '30min' },
      { before: 59 * MINUTE, after: 61 * MINUTE, offlineRuns: 2, schedule: '1h' },
      { before: 119 * MINUTE, after: 121 * MINUTE, offlineRuns: 3, schedule: '2h' },
      { before: 7 * HOUR + 59 * MINUTE, after: 8 * HOUR + MINUTE, offlineRuns: 5, schedule: '8h' },
      {
        before: 7 * HOUR + 59 * MINUTE,
        after: 8 * HOUR + MINUTE,
        offlineRuns: 6,
        schedule: '8h (capped)',
      },
    ])(
      'waits $schedule after offline run $offlineRuns before retrying',
      async ({ after, before, offlineRuns }) => {
        const { created, graph, runSpy, service, taskModel } = await setup(
          `Offline backoff ${offlineRuns}`,
          1,
        );
        await taskModel.update(created.taskId!, { totalTopics: offlineRuns });
        await addOfflineRuns(created.taskId!, offlineRuns, before);
        await taskModel.updateStatus(created.taskId!, 'paused', { error: 'DEVICE_OFFLINE' });

        const waiting = await service.tick(graph.goal.id);
        expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
        expect(runSpy).not.toHaveBeenCalled();

        await serverDB
          .update(taskTopics)
          .set({ updatedAt: new Date(Date.now() - after) })
          .where(eq(taskTopics.topicId, `tpc_offline_${offlineRuns}`));
        await service.tick(graph.goal.id);

        expect(runSpy).toHaveBeenCalledWith(
          expect.objectContaining({ taskId: created.taskId, trigger: 'goal' }),
        );
        expect(await decisionReasons(service, graph.goal.id)).toHaveLength(0);
      },
    );

    it('retries at once when presence shows the device back before the backoff ends', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup('Laptop woke up', 1);
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([
        { deviceId: 'device-laptop' } as never,
      ]);
      await taskModel.update(created.taskId!, { totalTopics: 1 });
      await addRun(created.taskId!, 1, DEVICE_OFFLINE_RUN_STATUS, {
        metadata: { boundDeviceId: 'device-laptop' },
      });
      await taskModel.updateStatus(created.taskId!, 'paused', { error: 'DEVICE_OFFLINE' });

      await service.tick(graph.goal.id);

      expect(runSpy).toHaveBeenCalledOnce();
    });

    it('asks a person once every offline retry found the device gone', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup(
        'Laptop never came back',
        1,
      );
      await taskModel.update(created.taskId!, { totalTopics: 7 });
      await addOfflineRuns(created.taskId!, 7, 10 * HOUR);
      await taskModel.updateStatus(created.taskId!, 'paused', { error: 'DEVICE_OFFLINE' });

      const gated = await service.tick(graph.goal.id);

      expect(gated).toMatchObject({ outcome: 'waiting_human', taskId: created.taskId });
      expect(runSpy).not.toHaveBeenCalled();
      expect(await decisionReasons(service, graph.goal.id)).toEqual([DEVICE_OFFLINE_GATE_REASON]);
    });

    it('keeps charging verification-rejected attempts to the budget', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup(
        'Rejections still count',
        2,
      );
      await addRun(created.taskId!, 1, DEVICE_OFFLINE_RUN_STATUS);
      await addRun(created.taskId!, 2, 'completed');
      await taskModel.update(created.taskId!, { totalTopics: 2 });
      await taskModel.updateStatus(created.taskId!, 'paused', {
        error: VERIFICATION_FAILED_ERROR,
      });

      // One offline run and one rejection: only the rejection is charged.
      await service.tick(graph.goal.id);
      expect(runSpy).toHaveBeenCalledOnce();

      await addRun(created.taskId!, 3, 'completed');
      await taskModel.update(created.taskId!, { totalTopics: 3 });
      await taskModel.updateStatus(created.taskId!, 'paused', {
        error: VERIFICATION_FAILED_ERROR,
      });
      runSpy.mockClear();

      const gated = await service.tick(graph.goal.id);

      expect(gated).toMatchObject({ outcome: 'waiting_human', taskId: created.taskId });
      expect(runSpy).not.toHaveBeenCalled();
      expect(await decisionReasons(service, graph.goal.id)).toEqual([
        'Task attempt budget was exhausted',
      ]);
    });
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

/**
 * Most real gates were machine problems pushed onto a person: a usage limit that
 * reset on its own hours later, a working directory missing on the device. These
 * pin that the coordinator waits out the first and asks about the second as a
 * machine gate rather than a judgment.
 */
describe('GoalService machine failures', () => {
  const MINUTE = 60 * 1000;
  const SESSION_LIMIT = "You've hit your session limit · resets 4:30am (Asia/Shanghai)";
  // 03:51 in Shanghai, a minute after the run hit the limit.
  const FAILED_AT = new Date('2026-10-05T19:50:01.000Z');

  const setup = async (title: string) => {
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockResolvedValue({ operationId: 'op-retry', success: true } as never);
    const scheduleSpy = vi
      .spyOn(LocalGoalScheduler.prototype, 'scheduleAdvance')
      .mockResolvedValue('scheduled');
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      // One attempt: a limited run that spent it would gate the retry.
      config: { recovery: { maxAttemptsPerTask: 1 } },
      tasks: ['Run on Claude Code'],
      title,
    });
    const created = await service.tick(graph.goal.id);
    runSpy.mockClear();
    return { created, graph, runSpy, scheduleSpy, service, taskModel };
  };

  const failRun = async (taskId: string, status: string, error: string, at: Date) => {
    const topicId = `tpc_machine_${taskId}`;
    await serverDB.insert(topics).values({ id: topicId, userId });
    await serverDB
      .insert(taskTopics)
      .values({ seq: 1, status, taskId, topicId, updatedAt: at, userId });
    const taskModel = new TaskModel(serverDB, userId);
    await taskModel.update(taskId, { totalTopics: 1 });
    await taskModel.updateStatus(taskId, 'paused', { error });
    await serverDB.update(tasks).set({ updatedAt: at }).where(eq(tasks.id, taskId));
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for a usage limit to reset, then retries without charging the attempt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
    vi.setSystemTime(new Date(FAILED_AT.getTime() + MINUTE));
    const { created, graph, runSpy, scheduleSpy, service } = await setup('Session limit');
    await failRun(created.taskId!, QUOTA_LIMITED_RUN_STATUS, SESSION_LIMIT, FAILED_AT);

    const waiting = await service.tick(graph.goal.id);

    expect(waiting).toMatchObject({
      message: expect.stringContaining('retrying at 2026-10-05T20:31:00.000Z'),
      outcome: 'waiting_external',
      taskId: created.taskId,
    });
    expect(runSpy).not.toHaveBeenCalled();
    expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
    // The tick that saw the failure books the advance for the reset.
    expect(scheduleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ delay: 39 * 60 + 59, goalId: graph.goal.id, trigger: 'wake' }),
    );

    vi.setSystemTime(new Date('2026-10-05T20:33:00.000Z'));
    const retried = await service.tick(graph.goal.id);

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: created.taskId, trigger: 'goal' }),
    );
    expect(retried).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
    expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
  });

  it('opens a machine gate that names the missing working directory', async () => {
    const { created, graph, runSpy, service } = await setup('Missing working directory');
    const error = 'Working directory does not exist: /Users/user/CodeProjects/LobeHub/lobehub';
    await failRun(created.taskId!, 'failed', error, new Date());

    const gated = await service.tick(graph.goal.id);

    expect(gated).toMatchObject({ outcome: 'waiting_human', taskId: created.taskId });
    expect(runSpy).not.toHaveBeenCalled();
    const after = await service.graph(graph.goal.id);
    const gate = after.nodes.find((node) => node.kind === 'decision')!;
    expect(gate.title).toBe(GOAL_MACHINE_GATE_TITLE);
    const [decision] = after.decisions;
    expect(decision.question).toBe(
      'Setup problem: Working directory does not exist: /Users/user/CodeProjects/LobeHub/lobehub. Create /Users/user/CodeProjects/LobeHub/lobehub on the device the agent runs on, or point the agent at a working directory that exists there. Fix it, then retry or retire this task node?',
    );
    expect(decision.options).toEqual([
      { id: 'retry', label: 'I fixed it — retry' },
      { id: 'retire', label: 'Retire task' },
    ]);
  });

  it('keeps a judgment failure on the ordinary gate', async () => {
    const { created, graph, service } = await setup('Unjudgeable delivery');
    await failRun(
      created.taskId!,
      'failed',
      'Acceptance review could not run; the delivery passed its verifiers but was never reviewed.',
      new Date(),
    );

    await service.tick(graph.goal.id);

    const gate = (await service.graph(graph.goal.id)).nodes.find(
      (node) => node.kind === 'decision',
    )!;
    expect(gate.title).toBe('Choose how to recover failed task');
  });

  it('asks about a device that stayed offline with a machine gate', async () => {
    const { created, graph, service, taskModel } = await setup('Device never came back');
    await taskModel.update(created.taskId!, { totalTopics: 7 });
    for (let seq = 1; seq <= 7; seq++) {
      const topicId = `tpc_machine_offline_${seq}`;
      await serverDB.insert(topics).values({ id: topicId, userId });
      await serverDB.insert(taskTopics).values({
        seq,
        status: DEVICE_OFFLINE_RUN_STATUS,
        taskId: created.taskId!,
        topicId,
        updatedAt: new Date(Date.now() - (17 - seq) * 60 * MINUTE),
        userId,
      });
    }
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'DEVICE_OFFLINE' });

    await service.tick(graph.goal.id);

    const gate = (await service.graph(graph.goal.id)).nodes.find(
      (node) => node.kind === 'decision',
    )!;
    expect(gate).toMatchObject({
      description: DEVICE_OFFLINE_GATE_REASON,
      title: GOAL_MACHINE_GATE_TITLE,
    });
  });
});
