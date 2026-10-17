// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { VerifyRunModel } from '@/database/models/verifyRun';
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
import { AiAgentService } from '@/server/services/aiAgent';

import { GoalCriteriaGeneratorService } from './criteriaGenerator';
import { GoalService } from './index';
import { approveRelease, pendingRelease } from './testUtils';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-release-review-test-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  vi.restoreAllMocks();
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

describe('approving a batch release', () => {
  /** A 50-unit batch whose five probes all settled clean. */
  const passedProbes = async (config?: Parameters<GoalService['create']>[0]['config']) => {
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
    const graph = await service.create({ config, title: 'Migrate stores' });
    await service.tick(graph.goal.id);
    const graphModel = new GoalGraphModel(serverDB, userId);
    const probeIds = (await service.graph(graph.goal.id)).goal.config!.rolloutState!.probeNodeIds;
    for (const id of probeIds) await graphModel.updateNodeStatus(graph.goal.id, id, 'resolved');
    return { goalId: graph.goal.id, graphModel, probeIds, service };
  };
  const unitsBeyondProbes = async (service: GoalService, goalId: string) =>
    (await service.graph(goalId)).nodes.filter(
      (n) => n.kind === 'task' && /^Unit \d+$/.test(n.title) && Number(n.title.slice(5)) > 5,
    );

  it('holds the first wave for the owner instead of releasing it on its own', async () => {
    const { goalId, service } = await passedProbes();

    const result = await service.tick(goalId);

    expect(result.outcome).toBe('waiting_human');
    // Nothing fans out before the owner has looked at the probes.
    expect(await unitsBeyondProbes(service, goalId)).toHaveLength(0);
    const after = await service.graph(goalId);
    const state = after.goal.config!.rolloutState!;
    expect(state.phase).toBe('release_review');
    expect(after.goal.status).toBe('paused');
    expect(after.goal.config!.pausedBy).toBe('release_review');
    const pending = await pendingRelease(service, goalId);
    expect(pending).toMatchObject({ authority: 'user', nodeId: state.releaseReviewNodeId });
    expect(pending!.options!.map((option) => option.id)).toEqual(['release', 'revise']);
    expect(pending!.question).toContain('start batch execution with wave 1 (5 units)');

    // The release is reviewed as a delivery: an acceptance on the gate node,
    // carrying the plan, every probe and the wave it would start.
    const acceptanceId = state.releaseGateAcceptanceId!;
    expect(acceptanceId).toBeDefined();
    const acceptance = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, acceptanceId),
    });
    expect(acceptance).toMatchObject({
      status: 'delivered',
      subjectId: state.releaseReviewNodeId,
      subjectType: 'goal_gate',
    });
    const [round] = await new VerifyRunModel(serverDB, userId).listByAcceptance(acceptanceId);
    const dossier = round.metadata!.releaseGate!;
    expect(dossier.kind).toBe('probes');
    expect(dossier.plan.content).toContain('把 store 换成 replica 支撑的实现');
    expect(dossier.units).toHaveLength(5);
    expect(dossier.nextWave.map((unit) => unit.title)).toEqual([
      'Unit 6',
      'Unit 7',
      'Unit 8',
      'Unit 9',
      'Unit 10',
    ]);
    // The goal is paused on this gate, yet the island still asks it — and
    // points at the report rather than offering a one-click answer.
    const island = await service.pendingForIsland();
    expect(island.decisions.find((row) => row.nodeId === state.releaseReviewNodeId)).toMatchObject({
      releaseGateAcceptanceId: acceptanceId,
    });
    // …and decided there, not by a one-click answer elsewhere.
    await expect(service.decide(goalId, pending!.id, 'release')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('releases the wave the owner approved, and records who approved it', async () => {
    const { goalId, service } = await passedProbes();
    await service.tick(goalId);
    const asked = await serverDB.query.briefs.findMany({
      where: (row, { isNull }) => isNull(row.resolvedAt),
    });
    expect(asked.filter((row) => (row.metadata as any)?.goal?.reviewAcceptanceId)).toHaveLength(1);

    await approveRelease(service, goalId);

    const after = await service.graph(goalId);
    const state = after.goal.config!.rolloutState!;
    expect(after.goal.status).toBe('running');
    expect(after.goal.config!.pausedBy).toBeUndefined();
    expect(await unitsBeyondProbes(service, goalId)).toHaveLength(5);
    expect(state.phase).toBe('mass');
    expect(state.gateLog!.at(-1)).toMatchObject({ approvedBy: 'user', outcome: 'released' });
    // The inbox's copy of the release is settled with it, not left asking.
    const open = await serverDB.query.briefs.findMany({
      where: (row, { isNull }) => isNull(row.resolvedAt),
    });
    expect(open.filter((row) => (row.metadata as any)?.goal?.kind === 'decision')).toHaveLength(0);
    // Spent on that wave: the next one needs its own approval.
    expect(state.releaseApproval).toBeUndefined();
  });

  it('hands a plan the owner sends back to the main Agent, never applying it alone', async () => {
    const { goalId, service } = await passedProbes();
    await service.tick(goalId);
    const before = (await service.graph(goalId)).goal.config!;
    const pending = await pendingRelease(service, goalId);

    await service.answerReleaseGate(pending!.nodeId, 'revise', '先补上 SSR 播种');

    let after = (await service.graph(goalId)).goal.config!;
    expect(after.rolloutState).toMatchObject({
      pendingRevision: { correction: '先补上 SSR 播种' },
      phase: 'plan_revision',
    });
    // This goal has no main Agent to rewrite the plan: it waits, and says so,
    // instead of pasting the correction under the plan.
    const result = await service.tick(goalId);
    after = (await service.graph(goalId)).goal.config!;
    expect(result.outcome).toBe('waiting_human');
    expect((await service.graph(goalId)).goal.status).toBe('paused');
    expect(after.rolloutState!.templateRevision).toBe(before.rolloutState!.templateRevision);
    expect(after.rollout!.spec?.recipeOutline).toBe(before.rollout!.spec?.recipeOutline);
  });

  it('drops the plan skill when the rewrite cannot land in it', async () => {
    const { goalId, service } = await passedProbes();
    await service.tick(goalId);
    const pending = await pendingRelease(service, goalId);
    await service.answerReleaseGate(pending!.nodeId, 'revise', '先补上 SSR 播种');
    const goalModel = new GoalModel(serverDB, userId);
    const state = (await service.graph(goalId)).goal.config!.rolloutState!;
    // The main Agent submitted its rewrite, but the plan skill it would land in
    // is gone, so no new version can be written.
    await goalModel.updateRolloutState(goalId, {
      ...state,
      pendingRevision: { ...state.pendingRevision!, revisedRecipe: '先播种，再换 replica' },
      planSkill: { id: 'doc_deleted_plan', name: 'migrate-stores-plan' },
    });

    await service.tick(goalId);

    const after = (await service.graph(goalId)).goal.config!;
    // Units copy the revised plan instead of loading the skill the owner sent back.
    expect(after.rolloutState!.planSkill).toBeUndefined();
    expect(after.rollout!.spec?.recipeOutline).toBe('先播种，再换 replica');
    expect(after.rolloutState!.phase).toBe('release_review');
  });

  it('takes a retry of the answer it recorded, and refuses a different one', async () => {
    const { goalId, service } = await passedProbes();
    await service.tick(goalId);
    const pending = await pendingRelease(service, goalId);
    await service.answerReleaseGate(pending!.nodeId, 'release');

    // The report's own write failed after the goal took the answer: the retry
    // finds it answered and lets the report catch up.
    await expect(service.answerReleaseGate(pending!.nodeId, 'release')).resolves.toBe(goalId);
    await expect(
      service.answerReleaseGate(pending!.nodeId, 'revise', '换一种做法'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('sends a plan sent back on the goal page to the main Agent as well', async () => {
    const { goalId, service } = await passedProbes();
    await service.tick(goalId);
    const before = (await service.graph(goalId)).goal.config!.rolloutState!;
    // The review report could not be opened, so the owner answers on the goal page.
    await new GoalModel(serverDB, userId).updateRolloutState(goalId, {
      ...before,
      releaseGateAcceptanceId: undefined,
    });
    const pending = await pendingRelease(service, goalId);

    await service.decide(goalId, pending!.id, 'revise', '先补上 SSR 播种');

    const after = (await service.graph(goalId)).goal.config!.rolloutState!;
    expect(after).toMatchObject({
      pendingRevision: { correction: '先补上 SSR 播种' },
      phase: 'plan_revision',
      templateRevision: before.templateRevision,
    });
    expect(after.probeNodeIds).toEqual(before.probeNodeIds);
  });

  it('releases a wave once when two advances pass the gate together', async () => {
    const { goalId, probeIds, service } = await passedProbes();

    // Two settled tasks each queued an advance; both see the gate pass, and the
    // owner is asked once.
    await Promise.all([service.tick(goalId), service.tick(goalId)]);
    expect(
      (await service.graph(goalId)).decisions.filter((d) => d.status === 'pending'),
    ).toHaveLength(1);
    const pending = await pendingRelease(service, goalId);
    await service.answerReleaseGate(pending!.nodeId, 'release');
    await Promise.all([service.tick(goalId), service.tick(goalId)]);

    const state = (await service.graph(goalId)).goal.config!.rolloutState!;
    const released = await unitsBeyondProbes(service, goalId);
    // One wave, once: no duplicate units and the cursor counts it once.
    expect(new Set(released.map((n) => n.title)).size).toBe(released.length);
    expect(state.massNodeIds).toHaveLength(released.length);
    expect(state.releasedCount).toBe(probeIds.length + released.length);
    expect(state.gateLog?.filter((entry) => entry.outcome === 'released')).toHaveLength(1);
  });

  /** The first wave approved and delivered, so the gate passes for the second. */
  const firstWaveDelivered = async (config?: Parameters<GoalService['create']>[0]['config']) => {
    const setup = await passedProbes(config);
    await setup.service.tick(setup.goalId);
    await approveRelease(setup.service, setup.goalId);
    const state = (await setup.service.graph(setup.goalId)).goal.config!.rolloutState!;
    for (const id of state.massNodeIds!)
      await setup.graphModel.updateNodeStatus(setup.goalId, id, 'resolved');
    return setup;
  };

  it('hands a later wave to the main Agent instead of releasing it', async () => {
    const { goalId, service } = await firstWaveDelivered();
    const agentId = 'goal-release-agent';
    await serverDB.insert(agents).values({ id: agentId, userId });
    const config = (await service.graph(goalId)).goal.config!;
    await serverDB
      .update(goals)
      .set({ agentId, config: { ...config, manager: { maxTurns: 4 } } })
      .where(eq(goals.id, goalId));
    const execAgent = vi.spyOn(AiAgentService.prototype, 'execAgent').mockResolvedValue({
      operationId: 'op-release-turn',
    } as Awaited<ReturnType<AiAgentService['execAgent']>>);

    await service.tick(goalId);

    expect(execAgent).toHaveBeenCalledTimes(1);
    const managerState = (await service.graph(goalId)).goal.config!.managerState!;
    expect(managerState.problemKind).toBe('rollout_release');
    expect(managerState.problem).toContain('wave 2 (5 units)');
    expect(await unitsBeyondProbes(service, goalId)).toHaveLength(5);
    expect(await pendingRelease(service, goalId)).toBeUndefined();
  });

  it('releases a later wave on the main Agent approval for that wave', async () => {
    const { goalId, service } = await firstWaveDelivered();
    const state = (await service.graph(goalId)).goal.config!.rolloutState!;
    await new GoalModel(serverDB, userId).updateRolloutState(goalId, {
      ...state,
      releaseApproval: {
        at: new Date().toISOString(),
        by: 'agent',
        revision: state.templateRevision,
        waveIndex: state.waveIndex,
      },
    });

    await service.tick(goalId);

    expect(await unitsBeyondProbes(service, goalId)).toHaveLength(10);
    expect((await service.graph(goalId)).goal.config!.rolloutState!.gateLog!.at(-1)).toMatchObject({
      approvedBy: 'agent',
      outcome: 'released',
      wave: 2,
    });
  });

  it('does not release a later wave on an approval left from an earlier one', async () => {
    const { goalId, service } = await firstWaveDelivered();
    const state = (await service.graph(goalId)).goal.config!.rolloutState!;
    await new GoalModel(serverDB, userId).updateRolloutState(goalId, {
      ...state,
      releaseApproval: {
        at: new Date().toISOString(),
        by: 'agent',
        revision: state.templateRevision,
        waveIndex: state.waveIndex - 1,
      },
    });

    await service.tick(goalId);

    expect(await unitsBeyondProbes(service, goalId)).toHaveLength(5);
    expect(await pendingRelease(service, goalId)).toBeDefined();
  });

  it('asks the owner for a later wave when no main Agent can take it', async () => {
    const { goalId, service } = await firstWaveDelivered();

    const result = await service.tick(goalId);

    expect(result.outcome).toBe('waiting_human');
    expect(await unitsBeyondProbes(service, goalId)).toHaveLength(5);
    const pending = await pendingRelease(service, goalId);
    expect(pending!.question).toContain('no main Agent could review the release');
    expect(pending!.question).toContain('wave 2 (5 units)');
  });
});
