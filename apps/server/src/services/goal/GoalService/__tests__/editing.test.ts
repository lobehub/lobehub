// @vitest-environment node
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { agents, goals, taskTopics, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TaskService } from '../../../task';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
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

  it('renames the goal without touching its requirement', async () => {
    const service = new GoalService(serverDB, userId);
    const longAsk = '继续并完成桌宠项目，在现有基础上完善 TTS 语音系统'.repeat(4);
    const graph = await service.create({ requirement: longAsk, title: longAsk });

    const updated = await service.updateTitle(graph.goal.id, '桌宠 TTS 语音系统');

    expect(updated.title).toBe('桌宠 TTS 语音系统');
    const read = (await service.graph(graph.goal.id)).goal;
    expect(read.title).toBe('桌宠 TTS 语音系统');
    expect(read.requirement).toBe(longAsk);
    await expect(service.updateTitle('goal_missing', 'x')).rejects.toThrow();
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
});
