// @vitest-environment node
import type { ExecAgentResult } from '@lobechat/types';
import { summarizeGoalSupervision } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { DocumentModel } from '@/database/models/document';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { WorkModel } from '@/database/models/work';
import {
  acceptances,
  agentOperations,
  agents,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goals,
  tasks,
  taskTopics,
  topics,
  users,
} from '@/database/schemas';
import { AiAgentService } from '@/server/services/aiAgent';
import { TaskService } from '@/server/services/task';
import { TaskRunnerService } from '@/server/services/taskRunner';

import { GoalService } from '../index';
import * as modelConfig from '../modelConfig';
import * as scheduler from '../scheduler';
import { GoalSupervisorService } from './index';
import { GoalSupervisorTools } from './tools';

const db = await getTestDB();
const userId = 'supervisor-test-user';
let sequence = 0;
const operationModel = new AgentOperationModel(db, userId);
const taskModel = new TaskModel(db, userId);
const goalModel = new GoalModel(db, userId);
const service = () => new GoalService(db, userId);

const runResult = (operationId: string, topicId: string, agentId = 'agent'): ExecAgentResult => ({
  agentId,
  assistantMessageId: 'message',
  autoStarted: true,
  createdAt: new Date().toISOString(),
  message: 'started',
  operationId,
  status: 'running',
  success: true,
  timestamp: new Date().toISOString(),
  topicId,
  userMessageId: 'user-message',
});

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  vi.spyOn(modelConfig, 'resolveGoalModelConfig').mockResolvedValue({
    model: 'test-model',
    provider: 'openai',
  });
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const id = `op-supervisor-${++sequence}`;
    const topicId = params.appContext!.topicId!;
    await operationModel.recordStart({
      agentId: params.agentId,
      appContext: { sourceMessageId: params.clientIds?.userMessageId },
      operationId: id,
      topicId,
    });
    return runResult(id, topicId, params.agentId);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(goalNodeDecisions);
  await db.delete(goalEdges);
  await db.delete(goalEvents);
  await db.delete(goalNodes);
  await db.delete(goals);
  await db.delete(acceptances);
  await db.delete(agentOperations);
  await db.delete(taskTopics);
  await db.delete(topics);
  await db.delete(tasks);
  await db.delete(agents);
  await db.delete(users);
});

const failedGoal = async (enabled = true, error = 'fetch failed: ECONNRESET') => {
  const graph = await service().create({
    config: { supervision: { enabled } },
    tasks: ['Finish existing report'],
    title: 'Interrupted delivery',
  });
  const created = await service().tick(graph.goal.id);
  const taskId = created.taskId!;
  const topicId = `topic-failed-${++sequence}`;
  const operationId = `op-failed-${sequence}`;
  await db.insert(topics).values({ id: topicId, userId });
  await operationModel.recordStart({ operationId, taskId, topicId });
  await operationModel.recordCompletion(operationId, {
    completionReason: 'error',
    error: { message: error },
    status: 'error',
  });
  await db
    .insert(taskTopics)
    .values({ operationId, seq: 1, status: 'failed', taskId, topicId, userId });
  await taskModel.update(taskId, { status: 'failed', error, totalTopics: 1 });
  return { goalId: graph.goal.id, nodeId: created.nodeId!, operationId, taskId };
};

/**
 * The run itself settled cleanly and something around it broke: the device link
 * dropped, or verification could not run. The Task is left `paused`, not `failed`,
 * and its operation is `done`, not `error`.
 */
const pipelineFailureGoal = async (
  error = '{"error":"DEVICE_OFFLINE","success":false}',
  withRun = true,
) => {
  const graph = await service().create({
    config: { supervision: { enabled: true } },
    tasks: ['Finish existing report'],
    title: 'Interrupted delivery',
  });
  const created = await service().tick(graph.goal.id);
  const taskId = created.taskId!;
  if (withRun) {
    const topicId = `topic-pipeline-${++sequence}`;
    const operationId = `op-pipeline-${sequence}`;
    await db.insert(topics).values({ id: topicId, userId });
    await operationModel.recordStart({ operationId, taskId, topicId });
    await operationModel.recordCompletion(operationId, {
      completionReason: 'done',
      status: 'done',
    });
    await db
      .insert(taskTopics)
      .values({ operationId, seq: 1, status: 'completed', taskId, topicId, userId });
  }
  await taskModel.update(taskId, { status: 'paused', error, totalTopics: withRun ? 1 : 0 });
  return { goalId: graph.goal.id, taskId };
};

const diagnose = async (goalId: string, action = 'retry') => {
  const state = (await goalModel.findById(goalId))!.config!.supervisorState!;
  const incident = state.incidents.at(-1)!;
  const tool = new GoalSupervisorTools({
    serverDB: db,
    userId,
    agentId: state.agentId,
    topicId: state.topicId,
    operationId: incident.supervisorOperationId,
    toolCallId: `resolve-${incident.id}`,
  });
  const scope = { goalId, incidentId: incident.id };
  await tool.inspectGoal(scope);
  await tool.inspectTask(scope);
  await tool.resolveInterruption({
    ...scope,
    action: action as 'retry' | 'escalate',
    instruction: 'Read existing checkpoint and only finish missing report delivery.',
    reason: 'The delivery upload failed after existing work was saved.',
  });
  await operationModel.recordCompletion(incident.supervisorOperationId!, {
    completionReason: 'done',
    status: 'done',
    totalCost: 0.1,
  });
  return incident;
};

describe('Goal Supervisor integration', () => {
  it.each([true, false])(
    'requires confirmed supervisor cancellation before deletion: %s',
    async (confirmed) => {
      const { goalId } = await failedGoal();
      await service().tick(goalId);
      const state = (await goalModel.findById(goalId))!.config!.supervisorState!;
      const operationId = state.incidents[0].supervisorOperationId!;
      const interrupt = vi
        .spyOn(AiAgentService.prototype, 'interruptTask')
        .mockImplementation(async () => {
          expect((await goalModel.findById(goalId))!.status).toBe('paused');
          return { success: true, deviceCancellationConfirmed: confirmed };
        });
      if (confirmed) {
        await service().delete(goalId);
        expect(await goalModel.findById(goalId)).toBeUndefined();
      } else {
        await expect(service().delete(goalId)).rejects.toThrow('exit was not confirmed');
        expect(await goalModel.findById(goalId)).toBeDefined();
      }
      expect(interrupt).toHaveBeenCalledWith({ operationId, topicId: state.topicId });
    },
  );

  it('retains the Goal when supervisor dispatch has no durable operation yet', async () => {
    const { goalId } = await failedGoal();
    vi.mocked(AiAgentService.prototype.execAgent).mockRejectedValueOnce(new Error('dispatch lost'));
    await service().tick(goalId);
    await expect(service().delete(goalId)).rejects.toThrow('dispatch is unconfirmed');
    expect(await goalModel.findById(goalId)).toBeDefined();
  });

  it('adopts a supervisor operation whose dispatch response was lost before deleting', async () => {
    const { goalId } = await failedGoal();
    const dispatch = vi.mocked(AiAgentService.prototype.execAgent).getMockImplementation()!;
    vi.mocked(AiAgentService.prototype.execAgent).mockImplementationOnce(async (params) => {
      await dispatch(params);
      throw new Error('response lost');
    });
    await service().tick(goalId);
    const interrupt = vi
      .spyOn(AiAgentService.prototype, 'interruptTask')
      .mockResolvedValue({ success: true });
    await service().delete(goalId);
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(await goalModel.findById(goalId)).toBeUndefined();
  });

  it('retains a Goal resumed during supervisor cancellation', async () => {
    const { goalId } = await failedGoal();
    await service().tick(goalId);
    vi.spyOn(AiAgentService.prototype, 'interruptTask').mockImplementation(async () => {
      await goalModel.updateStatus(goalId, 'running');
      return { success: true };
    });
    await expect(service().delete(goalId)).rejects.toThrow('changed during cancellation');
    expect(await goalModel.findById(goalId)).toBeDefined();
  });

  it('requires scoped inspections, rejects unrelated callers, and records one idempotent action', async () => {
    const { goalId } = await failedGoal();
    await service().tick(goalId);
    const state = (await goalModel.findById(goalId))!.config!.supervisorState!;
    const incident = state.incidents[0];
    const context = {
      serverDB: db,
      userId,
      agentId: state.agentId,
      topicId: state.topicId,
      operationId: incident.supervisorOperationId,
      toolCallId: 'resolve-1',
    };
    const tool = new GoalSupervisorTools(context);
    const scope = { goalId, incidentId: incident.id };
    const request = {
      ...scope,
      action: 'retry' as const,
      instruction: 'Inspect and reuse the saved report.',
      reason: 'Delivery transport failed.',
    };
    expect((await tool.resolveInterruption(request)).success).toBe(false);
    for (const changed of [
      { topicId: 'other-topic' },
      { operationId: 'other-op' },
      { agentId: 'other-agent' },
      { userId: 'other-user' },
    ]) {
      expect(
        (await new GoalSupervisorTools({ ...context, ...changed }).inspectGoal(scope)).success,
      ).toBe(false);
    }
    expect((await tool.inspectGoal(scope)).success).toBe(true);
    expect((await tool.inspectTask(scope)).success).toBe(true);
    expect((await tool.readArtifact({ ...scope, workVersionId: 'not-linked' })).success).toBe(
      false,
    );
    expect((await tool.resolveInterruption(request)).success).toBe(true);
    expect((await tool.resolveInterruption({ ...request, action: 'escalate' })).success).toBe(true);
    const current = (await goalModel.findById(goalId))!.config!.supervisorState!;
    expect(current.incidents[0].resolution).toMatchObject({
      action: 'retry',
      toolCallId: 'resolve-1',
    });
    expect(current.incidents[0].status).toBe('diagnosing');
    await service().pause(goalId);
    expect((await tool.inspectTask(scope)).success).toBe(false);
    expect((await tool.resolveInterruption(request)).success).toBe(false);
  });

  it('reads only linked accessible artifacts and labels mutable document text honestly', async () => {
    const { goalId, nodeId } = await failedGoal();
    const document = await new DocumentModel(db, userId).create({
      title: 'Checkpoint',
      content: 'saved result',
      fileType: 'text/plain',
      sourceType: 'api',
      source: 'test',
      totalCharCount: 12,
      totalLineCount: 1,
    });
    const work = await new WorkModel(db, userId).registerDocument({
      documentId: document.id,
      changeType: 'created',
      toolIdentifier: 'test',
      toolName: 'save',
    });
    await new GoalGraphModel(db, userId).attachWorkVersion(
      goalId,
      nodeId,
      work!.currentVersionId!,
      'input',
    );
    await service().tick(goalId);
    const state = (await goalModel.findById(goalId))!.config!.supervisorState!;
    const incident = state.incidents[0];
    const tool = new GoalSupervisorTools({
      serverDB: db,
      userId,
      agentId: state.agentId,
      topicId: state.topicId,
      operationId: incident.supervisorOperationId,
    });
    const result = await tool.readArtifact({
      goalId,
      incidentId: incident.id,
      workVersionId: work!.currentVersionId!,
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      content: 'saved result',
      source: 'current_document_not_version_snapshot',
      truncated: false,
    });
    expect(
      (await tool.readArtifact({ goalId, incidentId: incident.id, workVersionId: 'unrelated' }))
        .success,
    ).toBe(false);
  });

  it('persists a diagnostic topic, schedules its wake, retries once, and counts only consumed delivery', async () => {
    const { goalId, taskId } = await failedGoal();
    expect((await service().tick(goalId)).outcome).toBe('waiting_external');
    let graph = await service().graph(goalId);
    expect(graph.decisions).toHaveLength(0);
    expect(graph.goal.config?.supervisorState?.topicId).toBeTruthy();
    expect(scheduler.scheduleGoalAdvance).toHaveBeenCalled();
    expect(summarizeGoalSupervision(graph.goal.config?.supervisorState).effectiveRecoveries).toBe(
      0,
    );
    await diagnose(goalId);
    // A new service instance reads and resumes the persisted diagnosis.
    expect((await service().tick(goalId)).outcome).toBe('advanced');
    expect((await taskModel.findById(taskId))?.status).toBe('backlog');
    expect(AiAgentService.prototype.execAgent).toHaveBeenCalledTimes(1);
    const topicId = `topic-recovery-${++sequence}`;
    const operationId = `op-recovery-${sequence}`;
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockImplementation(async (params) => {
      expect(params.extraPrompt).toContain('existing checkpoint');
      await db.insert(topics).values({ id: topicId, userId });
      await db.insert(taskTopics).values({
        operationId,
        seq: 2,
        trigger: 'goal',
        status: 'running',
        taskId,
        topicId,
        userId,
      });
      return { ...runResult(operationId, topicId), taskId, taskIdentifier: 'T-1' };
    });
    await service().tick(goalId);
    graph = await service().graph(goalId);
    expect(graph.goal.config?.supervisorState?.incidents[0].status).toBe('retrying');
    expect(summarizeGoalSupervision(graph.goal.config?.supervisorState).effectiveRecoveries).toBe(
      0,
    );
    await taskModel.updateStatus(taskId, 'completed');
    await db.update(taskTopics).set({ status: 'completed' }).where(eq(taskTopics.topicId, topicId));
    await service().tick(goalId);
    graph = await service().graph(goalId);
    expect(summarizeGoalSupervision(graph.goal.config?.supervisorState)).toMatchObject({
      effectiveRecoveries: 1,
      effectiveRecoveryRate: 1,
    });
    expect(graph.spend?.totalCost).toBe(0.1);
    await service().tick(goalId);
    expect(
      summarizeGoalSupervision((await service().graph(goalId)).goal.config?.supervisorState)
        .effectiveRecoveries,
    ).toBe(1);
  });

  it('does not overwrite a pause that arrives during recovery application', async () => {
    const { goalId, taskId } = await failedGoal();
    await service().tick(goalId);
    await diagnose(goalId);
    const original = db.transaction.bind(db);
    let injected = false;
    vi.spyOn(db, 'transaction').mockImplementation(async (callback, config) => {
      if (!injected) {
        injected = true;
        await db.update(goals).set({ status: 'paused' }).where(eq(goals.id, goalId));
      }
      return original(callback, config);
    });
    expect((await service().tick(goalId)).outcome).toBe('no_progress');
    expect((await goalModel.findById(goalId))?.status).toBe('paused');
    expect((await taskModel.findById(taskId))?.status).toBe('failed');
    expect((await service().graph(goalId)).decisions).toHaveLength(0);
  });

  it('settles the final failed recovery even when the incident ledger is full', async () => {
    const { goalId, taskId } = await failedGoal();
    await goalModel.update(goalId, { config: { supervision: { enabled: true, maxIncidents: 1 } } });
    await service().tick(goalId);
    await diagnose(goalId);
    await service().tick(goalId);
    const topicId = `topic-failed-again-${++sequence}`;
    const operationId = `op-failed-again-${sequence}`;
    await db.insert(topics).values({ id: topicId, userId });
    await operationModel.recordStart({ operationId, taskId, topicId });
    await operationModel.recordCompletion(operationId, {
      completionReason: 'error',
      error: { message: 'fetch failed' },
      status: 'error',
    });
    await db
      .insert(taskTopics)
      .values({ operationId, seq: 2, status: 'failed', taskId, topicId, trigger: 'goal', userId });
    await taskModel.update(taskId, { status: 'failed', error: 'fetch failed', totalTopics: 2 });
    expect((await service().tick(goalId)).outcome).toBe('waiting_human');
    expect((await goalModel.findById(goalId))?.config?.supervisorState?.incidents[0].status).toBe(
      'unsuccessful',
    );
  });

  it('a newer cancelled recovery cannot take credit for the earlier delivery', async () => {
    const { goalId, taskId, operationId } = await failedGoal();
    await service().tick(goalId);
    await diagnose(goalId);
    await service().tick(goalId);
    const graph = await service().graph(goalId);
    const cancelledTopicId = `topic-cancelled-${++sequence}`;
    const cancelledOperationId = `op-cancelled-${sequence}`;
    await db.insert(topics).values({ id: cancelledTopicId, userId });
    await db.insert(taskTopics).values({
      operationId: cancelledOperationId,
      seq: 2,
      status: 'canceled',
      taskId,
      topicId: cancelledTopicId,
      trigger: 'goal',
      userId,
    });
    await new GoalSupervisorService(db, userId).recordDispatch(graph, taskId, cancelledOperationId);
    await db
      .update(taskTopics)
      .set({ status: 'completed' })
      .where(eq(taskTopics.operationId, operationId));
    await taskModel.update(taskId, { status: 'completed', totalTopics: 2 });
    expect((await service().tick(goalId)).outcome).toBe('advanced');
    expect(
      summarizeGoalSupervision((await service().graph(goalId)).goal.config?.supervisorState)
        .effectiveRecoveries,
    ).toBe(0);
  });

  it('adopts a goal-triggered accepted recovery after losing the dispatch receipt', async () => {
    const { goalId, taskId } = await failedGoal();
    await service().tick(goalId);
    await diagnose(goalId);
    await service().tick(goalId);
    const topicId = `topic-adopt-${++sequence}`;
    const operationId = `op-adopt-${sequence}`;
    await db.insert(topics).values({ id: topicId, userId });
    await db.insert(taskTopics).values({
      operationId,
      seq: 2,
      status: 'completed',
      taskId,
      topicId,
      trigger: 'goal',
      userId,
    });
    await taskModel.updateStatus(taskId, 'completed');
    await service().tick(goalId);
    expect((await goalModel.findById(goalId))?.config?.supervisorState?.incidents[0]).toMatchObject(
      { recoveryOperationId: operationId, status: 'recovered' },
    );
  });

  it('recovers a paused pipeline failure instead of leaving it on the human Gate', async () => {
    const { goalId, taskId } = await pipelineFailureGoal();
    expect((await service().tick(goalId)).outcome).toBe('waiting_external');
    expect((await service().graph(goalId)).decisions).toHaveLength(0);
    await diagnose(goalId);
    expect((await service().tick(goalId)).outcome).toBe('advanced');
    // The Task holds `paused`, so a recovery that only accepted `failed` would
    // silently do nothing here and escalate the incident.
    expect((await taskModel.findById(taskId))?.status).toBe('backlog');
    const graph = await service().graph(goalId);
    expect(graph.goal.config?.supervisorState?.incidents.at(-1)?.status).not.toBe('escalated');
  });

  it('does not overwrite a completion a person recorded during the diagnosis', async () => {
    const { goalId, taskId } = await pipelineFailureGoal();
    expect((await service().tick(goalId)).outcome).toBe('waiting_external');
    await diagnose(goalId);
    // The person settled the Task while the supervisor was still deciding.
    await taskModel.update(taskId, { status: 'completed', error: null });
    await service().tick(goalId);
    expect((await taskModel.findById(taskId))?.status).toBe('completed');
  });

  it('loses the claim when the Task moved to another recoverable state mid-diagnosis', async () => {
    // Routed as `paused`; a person then marks it `failed` without supplying a new
    // error, so the run's transport reason survives and the policy still accepts it.
    // Only claiming against the status the incident was opened on keeps this decision.
    const { goalId, taskId } = await failedGoal(true, '{"error":"DEVICE_OFFLINE","success":false}');
    await taskModel.update(taskId, { status: 'paused' });
    expect((await service().tick(goalId)).outcome).toBe('waiting_external');
    await diagnose(goalId);
    await taskModel.update(taskId, { status: 'failed' });
    await service().tick(goalId);
    expect((await taskModel.findById(taskId))?.status).toBe('failed');
  });

  it('escalates a diagnosis persisted before the opening status was recorded', async () => {
    const { goalId, taskId } = await pipelineFailureGoal();
    expect((await service().tick(goalId)).outcome).toBe('waiting_external');
    await diagnose(goalId);
    // A rolling deploy leaves incidents from the previous version with no record of
    // what they opened on, so they cannot prove the row is still theirs to claim.
    const state = (await goalModel.findById(goalId))!.config!.supervisorState!;
    await goalModel.updateSupervisorState(goalId, state.revision, {
      ...state,
      incidents: state.incidents.map(({ taskStatus: _drop, ...rest }) => rest),
    });
    expect(
      (await goalModel.findById(goalId))!.config!.supervisorState!.incidents.at(-1)?.taskStatus,
    ).toBeUndefined();

    await service().tick(goalId);

    expect((await taskModel.findById(taskId))?.status).toBe('paused');
    const after = (await goalModel.findById(goalId))!.config!.supervisorState!;
    expect(after.incidents.at(-1)?.status).toBe('escalated');
  });

  it('leaves a paused transport failure alone once a person marks it failed', async () => {
    // The run errored with a recoverable transport error and the lifecycle paused the
    // Task. A person then marks it failed without supplying a new error, so the
    // transport text survives and only the transition's author tells them apart.
    const { goalId, taskId } = await failedGoal();
    await taskModel.update(taskId, { status: 'paused' });
    await new TaskService(db, userId).updateStatus({ id: taskId, status: 'failed' }, { userId });

    const move = await service().tick(goalId);

    expect((await taskModel.findById(taskId))?.status).toBe('failed');
    expect(move.outcome).not.toBe('waiting_external');
  });

  it('without supervision the same transport failure opens a human Gate', async () => {
    const { goalId } = await failedGoal(false);
    expect((await service().tick(goalId)).outcome).toBe('waiting_human');
    expect((await service().graph(goalId)).decisions[0].authority).toBe('user');
    expect(AiAgentService.prototype.execAgent).not.toHaveBeenCalled();
  });

  it('does not diagnose or recover an authentication failure', async () => {
    const { goalId } = await failedGoal(true, 'InvalidProviderAPIKey');
    expect((await service().tick(goalId)).outcome).toBe('waiting_human');
    expect(AiAgentService.prototype.execAgent).not.toHaveBeenCalled();
    expect(
      summarizeGoalSupervision((await service().graph(goalId)).goal.config?.supervisorState),
    ).toMatchObject({ eligibleInterruptions: 0, escalated: 1 });
  });

  it('respects a user pause arriving while the diagnosis runs', async () => {
    const { goalId, taskId } = await failedGoal();
    await service().tick(goalId);
    await service().pause(goalId);
    await diagnose(goalId);
    expect((await service().tick(goalId)).outcome).toBe('no_progress');
    expect((await taskModel.findById(taskId))?.status).toBe('failed');
  });

  it('respects a manual Gate opened while diagnosis runs', async () => {
    const { goalId, taskId } = await failedGoal();
    await service().tick(goalId);
    const graphModel = new GoalGraphModel(db, userId);
    const node = await graphModel.createNode(goalId, {
      kind: 'decision',
      title: 'Approve publication',
    });
    await graphModel.createDecision(goalId, node!.id, {
      authority: 'user',
      question: 'Publish externally?',
    });
    await diagnose(goalId);
    expect((await service().tick(goalId)).outcome).toBe('waiting_human');
    expect((await taskModel.findById(taskId))?.status).toBe('failed');
  });

  it('excludes budget-blocked interruptions from the eligible recovery denominator', async () => {
    const { goalId, taskId } = await failedGoal();
    await goalModel.update(goalId, { maxRounds: 1 });
    expect((await service().tick(goalId)).outcome).toBe('waiting_human');
    const graph = await service().graph(goalId);
    expect(summarizeGoalSupervision(graph.goal.config?.supervisorState)).toMatchObject({
      eligibleInterruptions: 0,
      effectiveRecoveryRate: null,
      escalated: 1,
    });
    expect(AiAgentService.prototype.execAgent).not.toHaveBeenCalled();
    expect((await taskModel.findById(taskId))?.status).toBe('failed');
  });

  it('checks the budget again after paying for the diagnosis', async () => {
    const { goalId, taskId } = await failedGoal();
    await goalModel.update(goalId, { maxTotalCost: 0.05 });
    await service().tick(goalId);
    await diagnose(goalId);
    expect((await service().tick(goalId)).outcome).toBe('waiting_human');
    expect((await taskModel.findById(taskId))?.status).toBe('failed');
  });

  it('adopts an operation after the dispatch response was lost', async () => {
    const { goalId } = await failedGoal();
    const realMock = vi.mocked(AiAgentService.prototype.execAgent).getMockImplementation()!;
    vi.mocked(AiAgentService.prototype.execAgent).mockImplementationOnce(async (params) => {
      await realMock(params);
      throw new Error('lost response');
    });
    await service().tick(goalId);
    expect(
      (await goalModel.findById(goalId))!.config!.supervisorState!.incidents[0]
        .supervisorOperationId,
    ).toBeUndefined();
    const state = (await goalModel.findById(goalId))!.config!.supervisorState!;
    await operationModel.recordStart({
      operationId: 'unrelated-supervisor-turn',
      topicId: state.topicId,
      appContext: { sourceMessageId: 'unrelated-user-message' },
    });
    await service().tick(goalId);
    const adopted = (await goalModel.findById(goalId))!.config!.supervisorState!.incidents[0]
      .supervisorOperationId;
    expect(adopted).toBeTruthy();
    expect(adopted).not.toBe('unrelated-supervisor-turn');
    expect(AiAgentService.prototype.execAgent).toHaveBeenCalledTimes(1);
  });

  it('does not count a manually resumed or unrelated delivery', async () => {
    const { goalId, taskId } = await failedGoal();
    await service().tick(goalId);
    await diagnose(goalId);
    await service().tick(goalId);
    const graph = await service().graph(goalId);
    await new GoalSupervisorService(db, userId).recordProgress(graph, taskId, true);
    await taskModel.updateStatus(taskId, 'completed');
    await service().tick(goalId);
    expect(
      summarizeGoalSupervision((await service().graph(goalId)).goal.config?.supervisorState)
        .effectiveRecoveries,
    ).toBe(0);
  });
});
