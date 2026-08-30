// @vitest-environment node
import { GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
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
  tasks,
  taskTopics,
  topics,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';

import { TaskService } from '../task';
import { TaskRunnerService } from '../taskRunner';
import { GoalService } from './index';
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
  await serverDB.delete(acceptances);
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskTopics);
  await serverDB.delete(topics);
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
    expect(current.nodes.find((node) => node.kind === 'task')?.taskId).toBe(taskRows[0].id);
    expect(current.workVersions).toHaveLength(1);
  });

  it('starts the bound Work once when advances race on dispatch', async () => {
    // Overlapping advances (an event hook, a manual nudge, the sweep) both read
    // the task as backlog; without an atomic claim both would call runTask and
    // the user would pay for the same Work twice.
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockImplementation(async ({ taskId }) => ({ taskId }) as never);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Raced dispatch', work: ['Only run once'] });
    await service.tick(graph.goal.id);

    const results = await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.message.startsWith('Started task'))).toHaveLength(1);
  });

  it('retries a failed verification once when advances race on recovery', async () => {
    // The dispatch claim only covers starting a backlog Work; the automatic
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
      work: ['Retry me once'],
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

  it('hands back a dispatch claim whose worker died before the run existed', async () => {
    // The claim is taken just before `runTask` creates the topic. If the worker
    // dies in that sliver the task is `running` with no operation to reclaim,
    // and every later advance would report `waiting_external` forever.
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockRejectedValue(new Error('worker died'));
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ title: 'Orphaned claim', work: ['Start me'] });
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

  it('leaves a fresh dispatch claim alone', async () => {
    // The same shape a moment after the claim is just a run about to start.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockRejectedValue(new Error('worker died'));
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ title: 'Fresh claim', work: ['Start me'] });
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
      work: ['Costs a round'],
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

  it('leaves a deliberately paused goal paused when its budget changes', async () => {
    // Nothing distinguishes a user pause from a budget pause on the row, so the
    // reopen is limited to goals whose budget was actually binding.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'User paused', work: ['Wait'] });
    await service.pause(graph.goal.id);

    const updated = await service.setBudget(graph.goal.id, { maxTotalCost: 50 });

    expect(updated?.status).toBe('paused');
  });

  it('refuses to delete a goal whose running work cannot be stopped', async () => {
    // Deleting anyway would remove the only surface that can stop an operation
    // which keeps spending.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Unstoppable', work: ['Runs on'] });
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

  it('parks a goal nothing can move so the sweep stops re-picking it', async () => {
    // A goal with no Work can only report `no_progress`. Left `running` it is
    // selected by every newest-first scan forever, and enough of them starve
    // every other stalled goal out of the sweep's window.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Nothing to do' });

    const result = await service.tick(graph.goal.id);

    expect(result.outcome).toBe('no_progress');
    expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');
    expect(
      await GoalModel.listStalled(serverDB, { staleBefore: new Date(Date.now() - 60_000) }),
    ).not.toContainEqual(expect.objectContaining({ id: graph.goal.id }));
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
      work: ['Do the thing'],
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
      work: ['Do the thing'],
    });

    const seeded = graph.events.filter((event) => ['created', 'linked'].includes(event.eventType));
    expect(seeded.every((event) => event.actorType === 'user')).toBe(true);
    expect(seeded.every((event) => event.actorId === userId)).toBe(true);
  });

  it('separates what the coordinator decided from what the user asked for', async () => {
    // The audit trail recorded every transition as the goal's owner, so "what did
    // the system decide on its own" could not be answered from product data.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Attributed goal', work: ['Do the thing'] });

    // Seeding is the user's ask; claiming the Work and binding its task is not.
    await service.tick(graph.goal.id);

    const { events, nodes } = await service.graph(graph.goal.id);
    const work = nodes.find((node) => node.kind === 'task')!;
    const actorsFor = (eventType: string, entityId: string) =>
      events
        .filter((event) => event.eventType === eventType && event.entityId === entityId)
        .map((event) => ({ actorId: event.actorId, actorType: event.actorType }));

    expect(actorsFor('created', work.id)).toEqual([{ actorId: userId, actorType: 'user' }]);
    expect(actorsFor('activated', work.id)).toEqual([
      { actorId: GOAL_COORDINATOR_ACTOR_ID, actorType: 'system' },
    ]);
    expect(events.some((event) => event.actorType === 'system')).toBe(true);
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
    expect(task?.instruction).toContain(
      'Include the relevant artifact contents or exact excerpts and the raw outputs of decisive verification commands',
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
      message: 'Created Goal-level acceptance Work for the remaining contract',
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
        kind: 'task',
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

  it('reports the effects a tick actually produced, not just its outcome', async () => {
    // The rollup counts gates and findings from these effects, so a branch that
    // forgets to report one reads as "no human was ever involved" — silently,
    // and only in the trace. Driving the real path is the only thing that
    // catches it; a synthetic observation always agrees with itself.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ title: 'Effect reporting', work: ['Risky task'] });

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
      config: { recovery: { maxAttemptsPerTask: 3, maxStepsPerRun: 500 } },
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

  it('reclaims a stale running Work operation and starts the next attempt', async () => {
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
      work: ['Run a durable experiment'],
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

  it('charges stale Work usage before checking the replacement budget', async () => {
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
      work: ['Run an expensive experiment'],
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

  it('does not reclaim a running Work operation without a persisted topic id', async () => {
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockResolvedValue([
      { operationId: 'op-without-topic', topicId: null } as never,
    ]);
    const settleSpy = vi.spyOn(AgentOperationModel.prototype, 'settleStaleRunning');

    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { operationLeaseTimeoutMs: 60_000 } },
      title: 'Wait for topic persistence',
      work: ['Run a durable experiment'],
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
      work: ['Run a durable experiment'],
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
      work: ['Run a durable experiment'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Goal Work operation lease expired.',
    });

    const recovered = await service.tick(graph.goal.id);

    expect(runSpy).toHaveBeenCalledOnce();
    expect(recovered).toMatchObject({
      message: expect.stringContaining('Recovered abandoned task'),
      outcome: 'waiting_external',
    });
  });

  it('opens the decision gate only after the Work attempt budget is exhausted', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 1 } },
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
      config: { recovery: { maxAttemptsPerTask: 1 } },
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
