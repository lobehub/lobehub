// @vitest-environment node
import { GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';
import * as goalGraphUtils from '@lobechat/utils/goalGraph';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from '../../../taskRunner';
import { GoalCriteriaGeneratorService } from '../../criteriaGenerator';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
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

  it('re-checks measured acceptance in the same transaction as the achieved write', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'A runnable minimal training loop with evidence',
      title: 'Reproduce Ornith training',
      tasks: ['Implement minimal training loop'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'completed');
    await service.tick(graph.goal.id);
    await service.tick(graph.goal.id);
    const acceptanceTask = await service.tick(graph.goal.id);
    await taskModel.updateStatus(acceptanceTask.taskId!, 'completed');
    await service.tick(graph.goal.id);

    // Evidence changes after the pre-check: only the read inside the final
    // transaction (the one handed a `db`) sees the below-target observation.
    const internals = service as unknown as {
      evaluateMetricCriteria: (graph: unknown, db?: unknown) => Promise<unknown>;
    };
    const evaluate = internals.evaluateMetricCriteria;
    vi.spyOn(internals, 'evaluateMetricCriteria').mockImplementation(async (graph, db) =>
      db ? { allMet: false, criteria: [] } : evaluate(graph),
    );

    const result = await service.tick(graph.goal.id);
    expect(result).toMatchObject({ outcome: 'no_progress' });
    expect((await service.graph(graph.goal.id)).goal.status).not.toBe('achieved');
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

  it('builds the Goal-level Acceptance Task on the units a batch delivered', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 7 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 7,
        units: Array.from({ length: 7 }, (_, i) => `Unit ${i + 1}`),
        variants: [],
      },
      tasks: Array.from({ length: 5 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { rollout: { minHomogeneousUnits: 5, trigger: 'full' } },
      requirement: 'Migrate every store.',
      title: 'Batch to acceptance',
    });

    let acceptance;
    for (let i = 0; i < 30 && !acceptance; i++) {
      await service.tick(graph.goal.id);
      const current = await service.graph(graph.goal.id);
      for (const node of current.nodes) {
        if (node.taskId && node.title !== 'Complete full Goal acceptance')
          await taskModel.updateStatus(node.taskId, 'completed');
      }
      acceptance = current.nodes.find((node) => node.title === 'Complete full Goal acceptance');
    }

    // The report walks back from acceptance; the batch's units must be on that path.
    const current = await service.graph(graph.goal.id);
    const units = current.nodes
      .filter((node) => /^Unit \d+$/.test(node.title) && node.status === 'resolved')
      .map((node) => node.id);
    expect(acceptance).toBeTruthy();
    expect(units).toHaveLength(7);
    expect(
      current.edges
        .filter((edge) => edge.kind === 'depends_on' && edge.sourceNodeId === acceptance!.id)
        .map((edge) => edge.targetNodeId)
        .sort(),
    ).toEqual(units.sort());
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
});
