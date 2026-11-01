// @vitest-environment node
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { ExpertiseModel } from '@/database/models/expertise';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { agents, documents, goals, projects } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from '../../../taskRunner';
import { UserSkillService } from '../../../userSkill';
import { GoalCriteriaGeneratorService } from '../../criteriaGenerator';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
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
    // A wave the round already released, whose member broke and was retired.
    const massMember = await graphModel.createNode(graph.goal.id, {
      kind: 'task',
      scopeId: state.batchNodeId,
      title: 'Unit 6',
    });
    await graphModel.updateNodeStatus(graph.goal.id, massMember!.id, 'retired');

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
    await goalModel.updateRolloutState(graph.goal.id, {
      ...state,
      massNodeIds: [massMember!.id],
      phase: 'pattern_break',
    });
    await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));

    await service.decide(graph.goal.id, decision!.id, 'revise', '补上冷启动这一步');

    const after = await service.graph(graph.goal.id);
    const next = after.goal.config!.rolloutState!;
    // Decision #4: the broken unit runs again as a new task, the old one retires.
    expect(after.nodes.find((n) => n.id === broken)?.status).toBe('retired');
    // Both units that broke this round — the probe and the wave member — re-open.
    const reopenedNodes = next.probeNodeIds.map((id) => after.nodes.find((n) => n.id === id)!);
    expect(reopenedNodes.map((n) => n.title).sort()).toEqual(['Unit 1', 'Unit 6']);
    const reopened = reopenedNodes.find((n) => n.title === 'Unit 1')!;
    expect(
      after.edges.some(
        (e) =>
          e.kind === 'derived_from' && e.sourceNodeId === reopened.id && e.targetNodeId === broken,
      ),
    ).toBe(true);
    // Re-opening is not a new release: the roster is re-cut to what is still
    // owed, so the cursor counts the re-opened probes over the shorter roster,
    // and the units the class still owes stay queued for the waves.
    expect(next.releasedCount).toBe(next.probeNodeIds.length);
    expect(next.unitTitles).toContain('Unit 50');
    expect(new Set(next.unitTitles).size).toBe(next.unitTitles!.length);
    // The revised plan carries v1 forward and appends what changed, so the two
    // versions diff as "v1 + the v2 section", not as a replacement.
    const plan = after.nodes.find((n) => n.id === next.templateNodeId)!;
    expect(plan.description).toBe('把 store 换成 replica 支撑的实现\n\n### v2\n补上冷启动这一步');
    // The new canary is a fresh round: the old wave's retired member no longer
    // counts against its gate (it would re-open the same break at once).
    expect(next.massNodeIds).toBeUndefined();

    // The plan lives as a skill in the user's library: v1 at decomposition,
    // v2 when the break revised it — each version kept whole.
    const planSkill = next.planSkill!;
    expect(planSkill.name).toMatch(/^goal-plan-/);
    const skill = await new UserSkillService(serverDB, userId).getSkill(planSkill.id);
    expect(skill?.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(skill?.content).toContain('### v2\n补上冷启动这一步');
    expect(skill?.versions[0].content).not.toContain('### v2');
    // A re-opened unit names the skill, which carries every later revision…
    expect(reopened.description).toContain(`user-skills:${planSkill.name}`);
    // …and still carries the revised plan, in case the skill does not load.
    expect(reopened.description).toContain('### v2\n补上冷启动这一步');

    // The break taught the batch: a rule in its expertise, which later units'
    // acceptance adds as a clause — no standalone criterion that nothing mounts.
    expect(next.learnings).toMatchObject([{ revision: 1, title: '补上冷启动这一步' }]);
    const [learning] = next.learnings!;
    expect(learning.criterionId).toBeUndefined();
    const lesson = await new ExpertiseModel(serverDB, userId).findLesson(learning.lessonId);
    expect(lesson).toMatchObject({
      compilability: 'compilable',
      compiledCriterionId: null,
      enforcement: 'block',
    });

    // A unit dispatched after the break loads the skill on every run and is
    // judged by what the batch learned.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    await service.tick(graph.goal.id);
    const dispatched = (await service.graph(graph.goal.id)).nodes.find(
      (node) => next.probeNodeIds.includes(node.id) && node.taskId,
    )!;
    const task = await new TaskModel(serverDB, userId).findById(dispatched.taskId!);
    expect(task?.config).toMatchObject({ skills: [`user-skills:${planSkill.name}`] });
    const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject(
      'task',
      dispatched.taskId!,
    );
    // The learned rule is added to the unit's own contract, not substituted for
    // it: configured criteria would make the verifier check only those.
    expect(acceptance?.config?.verifyCriteriaIds).toBeUndefined();
    expect(acceptance?.requirement).toContain(dispatched.title);
    expect(acceptance?.requirement).toContain('- 补上冷启动这一步');
  });

  it('falls back to copying the revised plan when the skill revision does not land', async () => {
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
    const state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    // The plan skill was deleted from the library in the meantime.
    await serverDB.delete(documents).where(eq(documents.id, state.planSkill!.id));

    const decision = await graphModel.createDecision(graph.goal.id, state.assayNodeId!, {
      authority: 'user',
      options: [{ id: 'revise', label: 'Revise' }],
      question: 'Batch gate blocked',
      requestedUserId: userId,
    });
    await graphModel.updateNodeStatus(graph.goal.id, state.assayNodeId!, 'waiting');
    await goalModel.updateRolloutState(graph.goal.id, { ...state, phase: 'pattern_break' });
    await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));

    await service.decide(graph.goal.id, decision!.id, 'revise', '补上冷启动这一步');

    // The new round does not point units at a skill that lacks the revision:
    // they carry the revised plan themselves.
    const after = await service.graph(graph.goal.id);
    const next = after.goal.config!.rolloutState!;
    expect(next.planSkill).toBeUndefined();
    const probe = after.nodes.find((node) => node.id === next.probeNodeIds[0])!;
    expect(probe.description).toContain('### v2\n补上冷启动这一步');
    expect(probe.description).not.toContain('user-skills:');
  });

  it('mounts what a break taught on the agent that runs the units, even in a project', async () => {
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
    await serverDB.insert(agents).values([{ id: 'agt_batch', slug: 'agt-batch', userId }]);
    await serverDB.insert(projects).values({
      coordinatorAgentId: 'agt_batch',
      id: 'proj_batch',
      identifier: 'BAT',
      name: 'Batch project',
      userId,
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      agentId: 'agt_batch',
      projectId: 'proj_batch',
      title: 'Migrate stores in a project',
    });
    await service.tick(graph.goal.id);

    const graphModel = new GoalGraphModel(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    const decision = await graphModel.createDecision(graph.goal.id, state.assayNodeId!, {
      authority: 'user',
      options: [{ id: 'revise', label: 'Revise' }],
      question: 'Batch gate blocked',
      requestedUserId: userId,
    });
    await graphModel.updateNodeStatus(graph.goal.id, state.assayNodeId!, 'waiting');
    await goalModel.updateRolloutState(graph.goal.id, { ...state, phase: 'pattern_break' });
    await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));
    await service.decide(graph.goal.id, decision!.id, 'revise', '补上冷启动这一步');

    // A run's expertise snapshot reads the executing agent's domains, so that
    // is where the batch's rules must live for its units to receive them.
    const next = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    const domains = await new ExpertiseModel(serverDB, userId).listDomainsForAgent('agt_batch');
    expect(domains.map(({ domain }) => domain.id)).toContain(next.learningDomainId);
  });

  it('learns into one shared domain per agent, through the executor fallback', async () => {
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
    await serverDB.insert(agents).values([
      { id: 'agt_goal_main', slug: 'agt-goal-main', userId },
      { id: 'agt_gone_exec', slug: 'agt-gone-exec', userId },
    ]);
    const service = new GoalService(serverDB, userId);
    const graphModel = new GoalGraphModel(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const breakAndRevise = async (title: string) => {
      const graph = await service.create({
        agentId: 'agt_goal_main',
        config: { taskAgentId: 'agt_gone_exec' },
        title,
      });
      await service.tick(graph.goal.id);
      const state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
      const decision = await graphModel.createDecision(graph.goal.id, state.assayNodeId!, {
        authority: 'user',
        options: [{ id: 'revise', label: 'Revise' }],
        question: 'Batch gate blocked',
        requestedUserId: userId,
      });
      await graphModel.updateNodeStatus(graph.goal.id, state.assayNodeId!, 'waiting');
      await goalModel.updateRolloutState(graph.goal.id, { ...state, phase: 'pattern_break' });
      await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));
      // The dedicated executor is deleted before the break is answered.
      await serverDB.delete(agents).where(eq(agents.id, 'agt_gone_exec'));
      await service.decide(graph.goal.id, decision!.id, 'revise', '补上冷启动这一步');
      return (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    };

    // The owner already keeps a batch domain of their own, inherited by every
    // agent: an agent's rule must not land there.
    const ownerDomainId = await new ExpertiseModel(serverDB, userId).createDomain({
      brief: 'What the release gates of goal batches have learned.',
      carrier: { type: 'user' },
      domainFilter: 'Doing or verifying a unit of a goal batch.',
      title: 'Goal batch rules',
    });

    const first = await breakAndRevise('First batch');
    expect(first.learningDomainId).not.toBe(ownerDomainId);
    // Learned despite the stale executor: mounted on the goal agent it falls back to.
    expect(first.learnings).toHaveLength(1);
    const expertise = new ExpertiseModel(serverDB, userId);
    expect(
      (await expertise.listDomainsForAgent('agt_goal_main')).map(({ domain }) => domain.id),
    ).toContain(first.learningDomainId);

    // A second batch on the same agent reuses that domain instead of adding one.
    await serverDB
      .insert(agents)
      .values({ id: 'agt_gone_exec', slug: 'agt-gone-exec', userId })
      .onConflictDoNothing();
    const second = await breakAndRevise('Second batch');
    expect(second.learningDomainId).toBe(first.learningDomainId);
  });

  it('creates one batch domain when two goals on an agent learn at the same time', async () => {
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
    await serverDB.insert(agents).values([{ id: 'agt_shared', slug: 'agt-shared', userId }]);
    const service = new GoalService(serverDB, userId);
    const graphModel = new GoalGraphModel(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const openBreak = async (title: string) => {
      const graph = await service.create({ agentId: 'agt_shared', title });
      await service.tick(graph.goal.id);
      const state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
      const decision = await graphModel.createDecision(graph.goal.id, state.assayNodeId!, {
        authority: 'user',
        options: [{ id: 'revise', label: 'Revise' }],
        question: 'Batch gate blocked',
        requestedUserId: userId,
      });
      await graphModel.updateNodeStatus(graph.goal.id, state.assayNodeId!, 'waiting');
      await goalModel.updateRolloutState(graph.goal.id, { ...state, phase: 'pattern_break' });
      await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));
      return { decisionId: decision!.id, goalId: graph.goal.id };
    };
    const a = await openBreak('Batch A');
    const b = await openBreak('Batch B');

    // Both first breaks are answered at once.
    await Promise.all([
      service.decide(a.goalId, a.decisionId, 'revise', '补上冷启动这一步'),
      service.decide(b.goalId, b.decisionId, 'revise', '补上 SSR 播种这一步'),
    ]);

    const domainOf = async (goalId: string) =>
      (await service.graph(goalId)).goal.config!.rolloutState!.learningDomainId;
    expect(await domainOf(a.goalId)).toBe(await domainOf(b.goalId));
    const bound = await new ExpertiseModel(serverDB, userId).listDomainsForAgent('agt_shared');
    expect(bound.filter(({ domain }) => domain.title === 'Goal batch rules')).toHaveLength(1);
  });

  it('moves a batch from before plan skills into one at its next revision', async () => {
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
    const { planSkill: _written, ...legacy } = (await service.graph(graph.goal.id)).goal.config!
      .rolloutState!;
    const decision = await graphModel.createDecision(graph.goal.id, legacy.assayNodeId!, {
      authority: 'user',
      options: [{ description: '修订配方', id: 'revise', label: '修订配方并重探' }],
      question: 'Batch gate blocked',
      requestedUserId: userId,
    });
    await graphModel.updateNodeStatus(graph.goal.id, legacy.assayNodeId!, 'waiting');
    await goalModel.updateRolloutState(graph.goal.id, { ...legacy, phase: 'pattern_break' });
    await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));

    await service.decide(graph.goal.id, decision!.id, 'revise', '补上 SSR 播种这一步');

    const next = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    const skill = await new UserSkillService(serverDB, userId).getSkill(next.planSkill!.id);
    // The plan's earlier version becomes v1 and the revision v2, so version N
    // still reads as round N.
    expect(skill?.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(skill?.versions[0].content).toContain('把 store 换成 replica 支撑的实现');
    expect(skill?.versions[1].content).toContain('### v2\n补上 SSR 播种这一步');
  });
});
