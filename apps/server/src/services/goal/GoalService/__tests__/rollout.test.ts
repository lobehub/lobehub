// @vitest-environment node
import { GOAL_BATCH_ASSAY_TITLE } from '@lobechat/const/goal';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { goals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { UserSkillService } from '../../../userSkill';
import { GoalCriteriaGeneratorService } from '../../criteriaGenerator';
import { approveRelease, registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  /**
   * Regression: a model titles its probes around the unit — "迁移 device store
   * （探针）" for unit `device` — and the roster de-duplicated on exact titles,
   * so every probed unit was queued again and would run twice.
   */
  it('does not queue a probed unit again when the probe title wraps its name', async () => {
    const units = Array.from({ length: 12 }, (_, i) => `store${i + 1}`);
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 12 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 12,
        units,
        variants: [],
      },
      tasks: units.slice(0, 3).map((unit) => ({
        dependsOn: [],
        instruction: `把 src/store/${unit}.ts 换成 replica 实现，并补冷启动回归测试`,
        title: `迁移 ${unit} store（探针）`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Migrate 12 stores' });
    await service.tick(graph.goal.id);

    const roster = (await service.graph(graph.goal.id)).goal.config!.rolloutState!.unitTitles!;
    expect(roster).toHaveLength(12);
    expect(roster.slice(0, 3)).toEqual(units.slice(0, 3).map((u) => `迁移 ${u} store（探针）`));
    expect(roster.slice(3)).toEqual(units.slice(3));
  });

  it('materializes a fallback roster above the batch cap without trimming it', async () => {
    const units = Array.from({ length: 64 }, (_, i) => `Unit ${i + 1}`);
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 64 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 64,
        units,
        variants: [],
      },
      tasks: Array.from({ length: 3 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { rollout: { trigger: 'off' } },
      title: 'Migrate stores, no batch',
    });
    await service.tick(graph.goal.id);

    const after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'batch')).toHaveLength(0);
    // Every one of the 64 units is planned: the batch config's 60-unit roster
    // cap must never trim the ordinary decomposition.
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(64);
  });

  it('refuses to batch a roster above the cap instead of silently trimming it', async () => {
    const units = Array.from({ length: 64 }, (_, i) => `Unit ${i + 1}`);
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 64 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 64,
        units,
        variants: [],
      },
      tasks: Array.from({ length: 3 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Migrate stores' });
    await service.tick(graph.goal.id);

    const after = await service.graph(graph.goal.id);
    // A roster the batch cannot carry whole is refused, not truncated: the goal
    // still delivers all 64 units, as plain tasks.
    expect(after.nodes.filter((n) => n.kind === 'batch')).toHaveLength(0);
    expect(after.goal.config?.rolloutState).toBeUndefined();
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(64);
  });

  it('numbers a release after the waves a batch released before the counter existed', async () => {
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
    for (const id of state.probeNodeIds)
      await graphModel.updateNodeStatus(graph.goal.id, id, 'resolved');
    // A rollout from before this change: two waves out, no counter, no log.
    await goalModel.updateRolloutState(graph.goal.id, {
      ...state,
      gateLog: undefined,
      phase: 'mass',
      waveIndex: 2,
      wavesReleased: undefined,
    });

    await service.tick(graph.goal.id);
    await approveRelease(service, graph.goal.id);
    const next = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    expect(next.gateLog?.at(-1)).toMatchObject({ outcome: 'released', wave: 3 });
    expect(next.wavesReleased).toBe(3);
  });

  it('numbers a release after the waves a batch released before the counter existed, across a restart', async () => {
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
    for (const id of state.probeNodeIds)
      await graphModel.updateNodeStatus(graph.goal.id, id, 'resolved');
    // A rollout from before this change, restarted once: `waveIndex` reset to 0,
    // no counter, no log — but 20 roster units beyond the first canary are out.
    await goalModel.updateRolloutState(graph.goal.id, {
      ...state,
      gateLog: undefined,
      phase: 'mass',
      releasedCount: state.releasedCount! + 20,
      waveIndex: 0,
      wavesReleased: undefined,
    });

    await service.tick(graph.goal.id);
    await approveRelease(service, graph.goal.id);
    const next = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    // 20 units at the default wave size of 5 are four waves; this one is the fifth.
    expect(next.gateLog?.at(-1)).toMatchObject({ outcome: 'released', wave: 5 });
    expect(next.wavesReleased).toBe(5);
  });

  it('records each gate verdict — the release and the hold — with what it checked', async () => {
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
    const probeIds = (await service.graph(graph.goal.id)).goal.config!.rolloutState!.probeNodeIds;
    for (const id of probeIds) await graphModel.updateNodeStatus(graph.goal.id, id, 'resolved');

    // The probes settled clean: once the owner approves, the gate releases the
    // first wave and says why.
    await service.tick(graph.goal.id);
    await approveRelease(service, graph.goal.id);
    let state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    expect(state.gateLog).toHaveLength(1);
    expect(state.gateLog![0]).toMatchObject({
      outcome: 'released',
      releasedCount: 5,
      approvedBy: 'user',
      revision: 1,
      trigger: 'gate',
      wave: 1,
      waveIndex: 1,
    });
    expect(state.wavesReleased).toBe(1);
    expect(state.gateLog![0].checks).toContainEqual(
      expect.objectContaining({ count: 5, key: 'units_succeeded', passed: true, total: 5 }),
    );

    // One unit of that wave was rejected: the next verdict holds and names it.
    const [rejected, ...rest] = state.massNodeIds!;
    for (const id of rest) await graphModel.updateNodeStatus(graph.goal.id, id, 'resolved');
    await graphModel.updateNodeStatus(graph.goal.id, rejected, 'rejected');
    await service.tick(graph.goal.id);
    state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    expect(state.phase).toBe('pattern_break');
    expect(state.gateLog![1]).toMatchObject({ outcome: 'blocked', trigger: 'gate' });
    expect(state.gateLog![1].checks).toContainEqual(
      expect.objectContaining({ key: 'units_succeeded', nodeIds: [rejected], passed: false }),
    );
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

    // The correction is folded into the batch's recipe and briefs the re-opened
    // probes — later waves only read `policy.spec.recipeOutline`, so a note kept
    // only on the Template would never reach the tasks meant to test it.
    expect(after.goal.config!.rollout!.spec?.recipeOutline).toContain('补上 SSR 播种这一步');
    // The re-opened probes load the plan skill, whose latest version carries it.
    const openedProbe = after.nodes.find((n) => next.probeNodeIds.includes(n.id))!;
    expect(openedProbe.description).toContain(`user-skills:${next.planSkill!.name}`);
    const skill = await new UserSkillService(serverDB, userId).getSkill(next.planSkill!.id);
    expect(skill?.content).toContain('补上 SSR 播种这一步');
  });

  it('materializes and answers a pattern-break gate on a full rollout', async () => {
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
    const graph = await service.create({
      config: { rollout: { trigger: 'full' } },
      title: 'Migrate stores',
    });
    await service.tick(graph.goal.id);

    const before = await service.graph(graph.goal.id);
    const state = before.goal.config!.rolloutState!;
    // A `full` rollout creates no Assay — it skips the probe gate.
    expect(state.assayNodeId).toBeUndefined();

    // A break still has to be answerable: the coordinator must open the question
    // on a `decision` node even though this trigger made none.
    const openGate = (
      service as unknown as {
        openPatternBreakGate: (g: unknown, message: string, effects: unknown[]) => Promise<unknown>;
      }
    ).openPatternBreakGate.bind(service);
    await openGate(before, 'Unit 1 did not pass', []);

    const after = await service.graph(graph.goal.id);
    const next = after.goal.config!.rolloutState!;
    expect(next.phase).toBe('pattern_break');
    const gateNode = after.nodes.find((n) => n.id === next.assayNodeId);
    expect(gateNode?.kind).toBe('decision');
    const decision = after.decisions.find(
      (item) => item.nodeId === next.assayNodeId && item.status === 'pending',
    );
    expect(decision).toBeDefined();
    // The options carry ids only; labels and consequences are localized on the
    // client by id, so nothing English is persisted into the gate payload.
    expect(decision!.options?.map((option) => option.id)).toEqual(['revise', 'new_class']);
    expect(decision!.options?.every((option) => option.description === undefined)).toBe(true);

    // Answering it restarts the class, rather than leaving the goal parked.
    await service.decide(graph.goal.id, decision!.id, 'revise', '补上冷启动这一步');
    const restarted = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
    expect(restarted.phase).toBe('probe');
    expect(restarted.templateRevision).toBe(next.templateRevision + 1);
    // The break must not redispatch the whole 50-unit rollout at once: only a
    // canary re-probes, and the rest stay owed on the re-cut roster for waves.
    expect(restarted.probeNodeIds).toHaveLength(5);
    expect(restarted.releasedCount).toBe(5);
    expect(restarted.unitTitles).toHaveLength(50);
  });

  it('opens one gate when two advances see a full rollout break together', async () => {
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
    const graph = await service.create({
      config: { rollout: { trigger: 'full' } },
      title: 'Migrate stores',
    });
    await service.tick(graph.goal.id);
    const before = await service.graph(graph.goal.id);
    const openGate = (
      service as unknown as {
        openPatternBreakGate: (g: unknown, message: string, effects: unknown[]) => Promise<unknown>;
      }
    ).openPatternBreakGate.bind(service);

    // Both read the same snapshot with no Assay yet.
    await Promise.all([
      openGate(before, 'Unit 1 did not pass', []),
      openGate(before, 'Unit 2 did not pass', []),
    ]);

    // One Assay, one pending question, and it is the one the state records.
    const after = await service.graph(graph.goal.id);
    const next = after.goal.config!.rolloutState!;
    const assays = after.nodes.filter(
      (n) => n.kind === 'decision' && n.title === GOAL_BATCH_ASSAY_TITLE,
    );
    expect(assays).toHaveLength(1);
    const pending = after.decisions.filter((item) => item.status === 'pending');
    expect(pending.map((item) => item.nodeId)).toEqual([next.assayNodeId]);
  });

  it('judges the final wave like any other before closing the batch', async () => {
    const rollout = {
      recipeOutline: '把 store 换成 replica 支撑的实现',
      repeatable: true,
      unitCount: 7,
      units: Array.from({ length: 7 }, (_, i) => `Unit ${i + 1}`),
      variants: [],
    };
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      dependsOn: [],
      instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
      title: `Unit ${i + 1}`,
    }));
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 7 个同构的 store 迁移到 replica',
      rollout,
      tasks,
    });
    const graphModel = new GoalGraphModel(serverDB, userId);
    const service = new GoalService(serverDB, userId);

    const releaseFinalWave = async (title: string) => {
      const graph = await service.create({
        config: {
          rollout: { canarySize: 5, minHomogeneousUnits: 5, trigger: 'canary', waveSize: 7 },
        },
        title,
      });
      await service.tick(graph.goal.id);
      const probeIds = (await service.graph(graph.goal.id)).goal.config!.rolloutState!.probeNodeIds;
      for (const id of probeIds) await graphModel.updateNodeStatus(graph.goal.id, id, 'resolved');
      await service.tick(graph.goal.id);
      await approveRelease(service, graph.goal.id);
      const state = (await service.graph(graph.goal.id)).goal.config!.rolloutState!;
      // The last two units went out, and the batch is not closed on release.
      expect(state.massNodeIds).toHaveLength(2);
      expect(state.phase).toBe('mass');
      return { goalId: graph.goal.id, finalWave: state.massNodeIds! };
    };

    // A unit retired from the final wave stops the batch, as in any earlier wave.
    const held = await releaseFinalWave('Final wave with a retired unit');
    await service.retireNodes(held.goalId, [held.finalWave[0]], 'not needed');
    await graphModel.updateNodeStatus(held.goalId, held.finalWave[1], 'resolved');
    await service.tick(held.goalId);
    expect((await service.graph(held.goalId)).goal.config!.rolloutState!.phase).toBe(
      'pattern_break',
    );

    // A clean final wave closes it.
    const clean = await releaseFinalWave('Final wave delivered');
    for (const id of clean.finalWave)
      await graphModel.updateNodeStatus(clean.goalId, id, 'resolved');
    await service.tick(clean.goalId);
    expect((await service.graph(clean.goalId)).goal.config!.rolloutState!.phase).toBe('done');
  });
});
