// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ExpertiseModel } from '@/database/models/expertise';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { briefs, goals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from '../../../taskRunner';
import { GoalCriteriaGeneratorService } from '../../criteriaGenerator';
import { VERIFICATION_FAILED_ERROR } from '../../decideNextMove';
import { uncoveredAxisValues } from '../../spec';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  describe('answering a batch break', () => {
    const decompose = (variants: { axis: string; values: string[] }[] = []) =>
      vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
        problemStatement: '把 7 个同构的 store 迁移到 replica',
        rollout: {
          recipeOutline: '把 store 换成 replica 支撑的实现',
          repeatable: true,
          unitCount: 7,
          units: Array.from({ length: 7 }, (_, i) => `Unit ${i + 1}`),
          variants,
        },
        tasks: Array.from({ length: 5 }, (_, i) => ({
          dependsOn: [],
          instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
          title: `Unit ${i + 1}`,
        })),
      });
    const pendingBreak = async (service: GoalService, goalId: string) =>
      (await service.graph(goalId)).decisions.find(
        (item) =>
          item.status === 'pending' && item.options?.some((option) => option.id === 'revise'),
      )!;

    it('re-probes delivered units when the roster is exhausted and the gate held anyway', async () => {
      // An axis value no unit's brief mentions keeps the gate shut even with
      // every unit delivered.
      decompose([{ axis: 'render', values: ['ssr'] }]);
      const service = new GoalService(serverDB, userId);
      const graphModel = new GoalGraphModel(serverDB, userId);
      const graph = await service.create({
        config: { rollout: { minHomogeneousUnits: 5, trigger: 'full' } },
        title: 'Full rollout, axis untested',
      });
      await service.tick(graph.goal.id);
      const state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
      for (const id of [...state.probeNodeIds, ...(state.massNodeIds ?? [])])
        await graphModel.updateNodeStatus(graph.goal.id, id, 'resolved');
      await service.tick(graph.goal.id);
      expect((await service.graph(graph.goal.id)).goal.config!.rolloutState!.phase).toBe(
        'pattern_break',
      );

      const decision = await pendingBreak(service, graph.goal.id);
      await service.decide(graph.goal.id, decision.id, 'revise', '每个单元都按 ssr 路径验证');

      // The new canary is not empty: delivered units are re-probed under v2.
      const next = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
      expect(next.phase).toBe('probe');
      expect(next.probeNodeIds.length).toBeGreaterThan(0);
    });

    it('leaves the question open when the restart fails part-way, and restarts on a retry', async () => {
      decompose();
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({
        config: { rollout: { minHomogeneousUnits: 5, trigger: 'canary' } },
        title: 'Restart is atomic',
      });
      await service.tick(graph.goal.id);
      const openGate = (
        service as unknown as {
          openPatternBreakGate: (
            g: unknown,
            message: string,
            effects: unknown[],
          ) => Promise<unknown>;
        }
      ).openPatternBreakGate.bind(service);
      await openGate(await service.graph(graph.goal.id), 'Unit 1 did not pass', []);
      const before = await service.graph(graph.goal.id);
      const decision = await pendingBreak(service, graph.goal.id);

      // The restart dies after writing its new plan, while creating the next gate.
      await serverDB.execute(sql`
        CREATE OR REPLACE FUNCTION fail_next_assay() RETURNS trigger AS $$
        BEGIN
          IF NEW.kind = 'decision' THEN RAISE EXCEPTION 'worker stopped'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql
      `);
      await serverDB.execute(sql`
        CREATE TRIGGER fail_next_assay BEFORE INSERT ON goal_nodes
          FOR EACH ROW EXECUTE FUNCTION fail_next_assay()
      `);
      try {
        await expect(
          service.decide(graph.goal.id, decision.id, 'revise', '补上冷启动这一步'),
        ).rejects.toThrow();
      } finally {
        await serverDB.execute(sql`DROP TRIGGER IF EXISTS fail_next_assay ON goal_nodes`);
        await serverDB.execute(sql`DROP FUNCTION IF EXISTS fail_next_assay()`);
      }

      // Nothing of the half round survived, and the question is still open.
      const failed = await service.graph(graph.goal.id);
      expect(failed.nodes).toHaveLength(before.nodes.length);
      expect(failed.goal.config!.rolloutState!.phase).toBe('pattern_break');
      expect((await pendingBreak(service, graph.goal.id)).id).toBe(decision.id);

      // Answering again opens the next round.
      await service.decide(graph.goal.id, decision.id, 'revise', '补上冷启动这一步');
      const next = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
      expect(next.phase).toBe('probe');
      expect(next.templateRevision).toBe(2);
    });

    it('leaves a brief for the batch gate so Home keeps it after a dismissal', async () => {
      decompose();
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({
        config: { rollout: { minHomogeneousUnits: 5, trigger: 'canary' } },
        title: 'Batch gate brief',
      });
      await service.tick(graph.goal.id);
      const openGate = (
        service as unknown as {
          openPatternBreakGate: (
            g: unknown,
            message: string,
            effects: unknown[],
          ) => Promise<unknown>;
        }
      ).openPatternBreakGate.bind(service);
      await openGate(await service.graph(graph.goal.id), 'Unit 1 did not pass', []);
      const decision = await pendingBreak(service, graph.goal.id);

      const rows = await serverDB.select().from(briefs).where(eq(briefs.userId, userId));
      const brief = rows.find(
        (row) =>
          (row.metadata as { goal?: { decisionId?: string } } | null)?.goal?.decisionId ===
          decision.id,
      );
      expect(brief).toMatchObject({ type: 'decision' });
      // Revising needs a correction, so the brief sends the person to the goal
      // page rather than offering one-click answers.
      expect((brief!.actions as { key: string }[]).map((action) => action.key)).toEqual([
        'openGoal',
      ]);
    });

    it('does not re-park a goal whose gate was answered while its brief was written', async () => {
      decompose();
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({
        config: { rollout: { minHomogeneousUnits: 5, trigger: 'canary' } },
        title: 'Answered during the brief',
      });
      await service.tick(graph.goal.id);
      const internals = service as unknown as {
        briefs: { openDecision: (...args: unknown[]) => Promise<void> };
        openPatternBreakGate: (g: unknown, message: string, effects: unknown[]) => Promise<unknown>;
      };
      // The person answers the moment the gate is visible, before the brief lands.
      internals.briefs.openDecision = async () => {
        const decision = await pendingBreak(service, graph.goal.id);
        await service.decide(graph.goal.id, decision.id, 'revise', '补上冷启动这一步');
      };

      await internals.openPatternBreakGate.bind(service)(
        await service.graph(graph.goal.id),
        'Unit 1 did not pass',
        [],
      );

      // The answer resumed the goal on a new round; the opener must not undo it.
      const after = await service.graph(graph.goal.id);
      expect(after.goal.config!.rolloutState!.phase).toBe('probe');
      expect(after.goal.status).toBe('running');
      expect(after.goal.config?.pausedBy).toBeUndefined();
    });

    it('refuses to revise the recipe without a correction', async () => {
      decompose();
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({
        config: { rollout: { minHomogeneousUnits: 5, trigger: 'canary' } },
        title: 'Revise needs a correction',
      });
      await service.tick(graph.goal.id);
      const openGate = (
        service as unknown as {
          openPatternBreakGate: (
            g: unknown,
            message: string,
            effects: unknown[],
          ) => Promise<unknown>;
        }
      ).openPatternBreakGate.bind(service);
      await openGate(await service.graph(graph.goal.id), 'Unit 1 did not pass', []);
      const decision = await pendingBreak(service, graph.goal.id);

      await expect(service.decide(graph.goal.id, decision.id, 'revise', '  ')).rejects.toThrow(
        'Revising the recipe needs a correction',
      );
      // The question stays open for an answer that says what to change.
      expect((await pendingBreak(service, graph.goal.id)).id).toBe(decision.id);
    });

    it('fails the fork, keeping the question open, when the old rules cannot be retired', async () => {
      decompose();
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({
        config: { rollout: { minHomogeneousUnits: 5, trigger: 'canary' } },
        title: 'Fork with a stuck rule',
      });
      await service.tick(graph.goal.id);
      const openGate = (
        service as unknown as {
          openPatternBreakGate: (
            g: unknown,
            message: string,
            effects: unknown[],
          ) => Promise<unknown>;
        }
      ).openPatternBreakGate.bind(service);
      await openGate(await service.graph(graph.goal.id), 'Unit 1 did not pass', []);
      let decision = await pendingBreak(service, graph.goal.id);
      await service.decide(graph.goal.id, decision.id, 'revise', '补上冷启动这一步');
      await openGate(await service.graph(graph.goal.id), 'Unit 1 did not pass', []);
      decision = await pendingBreak(service, graph.goal.id);

      // Retiring the old rule fails.
      await serverDB.execute(sql`
        CREATE OR REPLACE FUNCTION fail_lesson_retire() RETURNS trigger AS $$
        BEGIN
          IF NEW.status = 'retired' THEN RAISE EXCEPTION 'retire failed'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql
      `);
      await serverDB.execute(sql`
        CREATE TRIGGER fail_lesson_retire BEFORE UPDATE ON expertise_lessons
          FOR EACH ROW EXECUTE FUNCTION fail_lesson_retire()
      `);
      try {
        await expect(
          service.decide(graph.goal.id, decision.id, 'new_class', '按新类型处理'),
        ).rejects.toThrow();
      } finally {
        await serverDB.execute(sql`DROP TRIGGER IF EXISTS fail_lesson_retire ON expertise_lessons`);
        await serverDB.execute(sql`DROP FUNCTION IF EXISTS fail_lesson_retire()`);
      }

      // The batch still knows the rule (so retiring it can be retried), and the
      // question is still there to answer.
      const state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
      expect(state.learnings).toHaveLength(1);
      expect((await pendingBreak(service, graph.goal.id)).id).toBe(decision.id);
    });

    it('forks a new class from the original outline, not the revised plan', async () => {
      decompose();
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({
        config: { rollout: { minHomogeneousUnits: 5, trigger: 'canary' } },
        title: 'Fork after a revision',
      });
      await service.tick(graph.goal.id);
      const openGate = (
        service as unknown as {
          openPatternBreakGate: (
            g: unknown,
            message: string,
            effects: unknown[],
          ) => Promise<unknown>;
        }
      ).openPatternBreakGate.bind(service);

      await openGate(await service.graph(graph.goal.id), 'Unit 1 did not pass', []);
      let decision = await pendingBreak(service, graph.goal.id);
      await service.decide(graph.goal.id, decision.id, 'revise', '补上冷启动这一步');
      const [taught] = (await service.graph(graph.goal.id)).goal.config!.rolloutState!.learnings!;
      await openGate(await service.graph(graph.goal.id), 'Unit 1 did not pass', []);
      decision = await pendingBreak(service, graph.goal.id);
      await service.decide(graph.goal.id, decision.id, 'new_class', '按新类型处理');

      const after = await service.graph(graph.goal.id);
      const plan = after.nodes.find(
        (node) => node.id === after.goal.config!.rolloutState!.templateNodeId,
      )!;
      // The v2 correction belongs to the old class; the fork starts clean.
      expect(plan.description).not.toContain('补上冷启动这一步');
      expect(plan.description).toContain('把 store 换成 replica 支撑的实现');
      // …and so do its rules: the old class's learnings do not bind the new one.
      expect(after.goal.config!.rolloutState!.learnings).toBeUndefined();
      expect(after.goal.config!.rolloutState!.learningDomainId).toBeUndefined();
      // The old class's rule also stops reaching runs: retired in the shared domain.
      expect((await new ExpertiseModel(serverDB, userId).findLesson(taught.lessonId))?.status).toBe(
        'retired',
      );
    });
  });

  it('routes a batch unit out of verification retries through the batch gate', async () => {
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
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 1 } },
      title: 'Migrate stores',
    });
    await service.tick(graph.goal.id);
    const dispatched = await service.tick(graph.goal.id);
    expect(dispatched.taskId).toBeDefined();

    // The unit's one attempt failed verification: no attempts left.
    const taskModel = new TaskModel(serverDB, userId);
    await taskModel.update(dispatched.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(dispatched.taskId!, 'paused', {
      error: VERIFICATION_FAILED_ERROR,
    });
    // The other probes dispatch first; the paused unit's turn follows.
    for (let i = 0; i < 8; i++) {
      await service.tick(graph.goal.id);
      if ((await service.graph(graph.goal.id)).goal.config!.rolloutState!.phase !== 'probe') break;
    }

    // It breaks the class — revise the recipe and re-probe — rather than
    // parking on an ordinary retry/retire gate for one task.
    const state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    expect(state.phase).toBe('pattern_break');
    expect(state.gateLog?.at(-1)).toMatchObject({
      nodeId: dispatched.nodeId,
      outcome: 'blocked',
      trigger: 'unit',
    });
  });

  it('waits for the device of a batch unit instead of breaking the batch', async () => {
    // A sleeping laptop is not the recipe's fault. Routed to the batch gate first,
    // one device the probe could not reach paused the whole rollout and asked the
    // owner to revise or fork the recipe.
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
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockRejectedValueOnce(new Error('DEVICE_NOT_FOUND'))
      .mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Migrate stores on a sleeping laptop' });
    let parked = await service.tick(graph.goal.id);
    for (let i = 0; i < 10 && runSpy.mock.calls.length === 0; i++)
      parked = await service.tick(graph.goal.id);
    expect(parked.message).toContain('waiting for its device to reconnect');

    // The other probes dispatch; the parked unit's turn comes round again.
    for (let i = 0; i < 8; i++) await service.tick(graph.goal.id);

    const current = await service.graph(graph.goal.id);
    expect(current.goal.config!.rolloutState!.phase).toBe('probe');
    expect(current.decisions.filter((item) => item.status === 'pending')).toHaveLength(0);
    expect(await new TaskModel(serverDB, userId).findById(parked.taskId!)).toMatchObject({
      error: 'DEVICE_NOT_FOUND',
      status: 'paused',
    });
    expect(runSpy.mock.calls.filter(([params]) => params.taskId === parked.taskId)).toHaveLength(1);
  });

  it('stops the running Tasks of the members a restart retires', async () => {
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
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Migrate stores' });
    await service.tick(graph.goal.id);
    for (let i = 0; i < 5; i++) await service.tick(graph.goal.id);

    const graphModel = new GoalGraphModel(serverDB, userId);
    const goalModel = new GoalModel(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const before = await service.graph(graph.goal.id);
    const state = before.goal.config!.rolloutState!;
    const [broken, sibling] = state.probeNodeIds.map((id) =>
      before.nodes.find((node) => node.id === id)!,
    );
    expect(sibling.taskId).toBeTruthy();
    // One unit broke while a sibling is still running.
    await graphModel.updateNodeStatus(graph.goal.id, broken.id, 'rejected');
    await taskModel.updateStatus(sibling.taskId!, 'running');

    const decision = await graphModel.createDecision(graph.goal.id, state.assayNodeId!, {
      authority: 'user',
      options: [{ id: 'revise', label: 'Revise' }],
      question: 'Unit 1 did not pass',
      requestedUserId: userId,
    });
    await graphModel.updateNodeStatus(graph.goal.id, state.assayNodeId!, 'waiting');
    await goalModel.updateRolloutState(graph.goal.id, { ...state, phase: 'pattern_break' });
    await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));

    await service.decide(graph.goal.id, decision!.id, 'revise', '补上冷启动这一步');

    // The sibling is retired and its Task stopped — it no longer runs beside
    // the probe that replaces it.
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.find((node) => node.id === sibling.id)?.status).toBe('retired');
    const [task] = await taskModel.findByIds([sibling.taskId!]);
    expect(task.status).toBe('canceled');
  });

  it('keeps a re-opened probe briefed with its variant assignment', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 50 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 50,
        units: Array.from({ length: 50 }, (_, i) => `Unit ${i + 1}`),
        variants: [{ axis: 'render', values: ['ssr', 'csr'] }],
      },
      tasks: Array.from({ length: 5 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现，按 ${i === 0 ? 'ssr' : 'csr'} 路径验证`,
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
    const ssrProbe = before.nodes.find((node) => node.title === 'Unit 1')!;
    await graphModel.updateNodeStatus(graph.goal.id, ssrProbe.id, 'rejected');
    const decision = await graphModel.createDecision(graph.goal.id, state.assayNodeId!, {
      authority: 'user',
      options: [{ id: 'revise', label: 'Revise' }],
      question: 'Unit 1 did not pass',
      requestedUserId: userId,
    });
    await graphModel.updateNodeStatus(graph.goal.id, state.assayNodeId!, 'waiting');
    await goalModel.updateRolloutState(graph.goal.id, { ...state, phase: 'pattern_break' });
    await serverDB.update(goals).set({ status: 'paused' }).where(eq(goals.id, graph.goal.id));

    await service.decide(graph.goal.id, decision!.id, 'revise', '补上冷启动这一步');

    // The re-opened probe still says which variant it covers, so the gate does
    // not report the axis value it tested as untested.
    const after = await service.graph(graph.goal.id);
    const next = after.goal.config!.rolloutState!;
    const reopened = after.nodes.find(
      (node) => next.probeNodeIds.includes(node.id) && node.title === 'Unit 1',
    )!;
    expect(reopened.description).toContain('按 ssr 路径验证');
    const probes = after.nodes.filter((node) => next.probeNodeIds.includes(node.id));
    expect(
      uncoveredAxisValues(
        [{ axis: 'render', values: ['ssr', 'csr'] }],
        probes.map((node) => ({ instruction: node.description ?? '', title: node.title })),
      ),
    ).not.toContainEqual({ axis: 'render', value: 'ssr' });
  });
});
