// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';
import {
  acceptances,
  agents,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goals,
  tasks,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from '../taskRunner';
import { GoalService } from './index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  // PGlite does not consistently order the nested user -> goal -> graph
  // cascades, so clear graph leaves explicitly before their owned roots.
  await serverDB.delete(goalNodeDecisions);
  await serverDB.delete(goalEdges);
  await serverDB.delete(goalEvents);
  await serverDB.delete(goalNodes);
  await serverDB.delete(goals);
  await serverDB.delete(acceptances);
  await serverDB.delete(tasks);
  await serverDB.delete(agents);
  await serverDB.delete(users);
});

describe('GoalService', () => {
  it('creates only one responsible task when ticks race on the same work node', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Concurrent goal', work: ['Single owner work'] });

    const results = await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);
    const current = await service.graph(graph.goal.id);
    const taskRows = await serverDB.select().from(tasks);

    expect(results.filter((result) => result.outcome === 'advanced')).toHaveLength(1);
    expect(taskRows).toHaveLength(1);
    expect(current.nodes.find((node) => node.kind === 'work')?.taskId).toBe(taskRows[0].id);
    expect(current.workVersions).toHaveLength(1);
  });

  it('keeps the overall requirement as background while making the current work authoritative', async () => {
    const service = new GoalService(serverDB, userId);
    const requirement = `Generate verified training data. ${'Detailed acceptance evidence. '.repeat(20)}`;
    const graph = await service.create({
      requirement,
      title: 'Long requirement goal',
      work: ['Generate training data'],
    });

    const created = await service.tick(graph.goal.id);
    const task = await new TaskModel(serverDB, userId).findById(created.taskId!);

    expect(created.outcome).toBe('advanced');
    expect(task?.description).toBe('Generate training data');
    expect(task?.instruction).toContain(requirement);
    expect(task?.instruction).toContain(
      'Current Work contract (authoritative execution scope): Generate training data',
    );
    expect(task?.instruction).toContain('Do not implement, validate, or pre-empt any sibling');
    expect(task?.instruction).toContain(
      'Do not invoke Acceptance skills or Acceptance CLI commands',
    );
  });

  it('gates every responsible task with a work-scoped Acceptance requirement', async () => {
    const service = new GoalService(serverDB, userId);
    const agentId = 'goal-work-verifier-agent';
    await serverDB.insert(agents).values({ id: agentId, title: 'Goal worker', userId });
    const graph = await service.create({
      agentId,
      requirement: 'Generate data, then train and evaluate a model.',
      title: 'Two-stage experiment',
      work: ['Generate isolated data'],
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
    expect(acceptance?.requirement).toContain('Verify only this Work: Generate isolated data.');
    expect(acceptance?.requirement).toContain(
      'Ignore sibling and downstream Work deliverables; they are verified by their own Tasks.',
    );
  });

  it('requires a Goal-level Acceptance Work before marking the complete goal achieved', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'A runnable minimal training loop with evidence',
      title: 'Reproduce Ornith training',
      work: ['Implement minimal training loop'],
    });

    const created = await service.tick(graph.goal.id);
    expect(created).toMatchObject({ outcome: 'advanced' });
    expect(created.taskId).toBeDefined();

    const waitingGraph = await service.graph(graph.goal.id);
    expect(waitingGraph.nodes.find((node) => node.kind === 'work')).toMatchObject({
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
      message: 'Created Goal-level acceptance Work for the remaining contract',
      outcome: 'advanced',
    });

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

    await taskModel.updateStatus(acceptanceTaskCreated.taskId!, 'completed');
    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');

    const achieved = await service.tick(graph.goal.id);
    expect(achieved).toMatchObject({
      message: 'Goal-level acceptance passed',
      outcome: 'achieved',
    });
    expect((await service.graph(graph.goal.id)).goal.status).toBe('achieved');
  });

  it('does not mark a required goal achieved when only its initial Work is complete', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'Return a supplier list with fixed prices.',
      title: 'Find BW150 suppliers and fixed prices',
      work: ['Verify the BW150 product identity'],
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
        kind: 'work',
        status: 'proposed',
        title: 'Complete full Goal acceptance',
      }),
    );
  });

  it('creates only one Goal-level Acceptance Work when terminal ticks race', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'Return three verified supplier quotes.',
      title: 'Find supplier quotes',
      work: ['Research suppliers'],
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

  it('evolves a failed work task into a durable decision gate', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ title: 'Failure recovery', work: ['Risky work'] });
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

  it('automatically retries failed Work verification within policy budget', async () => {
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
      config: { recovery: { maxAttemptsPerWork: 3, maxStepsPerRun: 500 } },
      title: 'Recover BW 150 research',
      work: ['Verify Micron BW 150 suppliers'],
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

  it('opens the decision gate only after the Work attempt budget is exhausted', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerWork: 1 } },
      title: 'Bounded recovery',
      work: ['Verify Micron BW 150 suppliers'],
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
      config: { recovery: { maxAttemptsPerWork: 1 } },
      requirement: 'Return three verified supplier quotes.',
      title: 'Bounded terminal acceptance',
      work: ['Complete full Goal acceptance'],
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
    const graph = await service.create({ title: 'Paused work', work: ['Wait for review'] });
    const created = await service.tick(graph.goal.id);

    await taskModel.updateStatus(created.taskId!, 'paused', { error: null });
    const waiting = await service.tick(graph.goal.id);

    expect(waiting).toMatchObject({
      outcome: 'waiting_human',
      taskId: created.taskId,
    });
    expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
  });

  it('only selects work whose explicit dependencies are resolved', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Dependency-aware goal' });
    const prerequisite = await service.addNode(graph.goal.id, {
      kind: 'work',
      priority: 0,
      title: 'Collect evidence',
    });
    const dependent = await service.addNode(graph.goal.id, {
      kind: 'work',
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
