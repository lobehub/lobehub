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
      // Nothing to re-run: the rewrite goes straight back to the review.
      pendingRevision: {
        ...state.pendingRevision!,
        rerun: [],
        revisedRecipe: '先播种，再换 replica',
      },
      planSkill: { id: 'doc_deleted_plan', name: 'migrate-stores-plan' },
    });

    await service.tick(goalId);

    const after = (await service.graph(goalId)).goal.config!;
    // Units copy the revised plan instead of loading the skill the owner sent back.
    expect(after.rolloutState!.planSkill).toBeUndefined();
    expect(after.rollout!.spec?.recipeOutline).toBe('先播种，再换 replica');
    expect(after.rolloutState!.phase).toBe('release_review');
  });

  /** Send the plan back from the report and land the main Agent's rewrite of it. */
  const sendBackAndRewrite = async (service: GoalService, goalId: string, rerun?: string[]) => {
    const pending = await pendingRelease(service, goalId);
    await service.answerReleaseGate(pending!.nodeId, 'revise', '每个 PR 都要过 codex review 和 CI');
    const goalModel = new GoalModel(serverDB, userId);
    const state = (await service.graph(goalId)).goal.config!.rolloutState!;
    await goalModel.updateRolloutState(goalId, {
      ...state,
      pendingRevision: {
        ...state.pendingRevision!,
        ...(rerun && { rerun }),
        revisedRecipe: '换 replica，并让 PR 过 codex review 和 CI',
      },
    });
    return service.tick(goalId);
  };
  const derivedFrom = async (goalId: string, nodeId: string) =>
    (await serverDB.query.goalEdges.findMany({ where: eq(goalEdges.goalId, goalId) })).find(
      (edge) => edge.kind === 'derived_from' && edge.sourceNodeId === nodeId,
    )?.targetNodeId;

  it('re-runs the reviewed experiments on a sent-back plan before the owner reviews again', async () => {
    const { goalId, graphModel, probeIds, service } = await passedProbes();
    await service.tick(goalId);
    const before = (await service.graph(goalId)).goal.config!.rolloutState!;

    const result = await sendBackAndRewrite(service, goalId);

    expect(result.outcome).toBe('advanced');
    const graph = await service.graph(goalId);
    const state = graph.goal.config!.rolloutState!;
    // The experiments run again in their own round, under the same gate: the
    // owner is not asked about results the correction was about.
    expect(await pendingRelease(service, goalId)).toBeUndefined();
    expect(state).toMatchObject({
      assayNodeId: before.assayNodeId,
      phase: 'probe',
      releaseGateAcceptanceId: before.releaseGateAcceptanceId,
      templateNodeId: before.templateNodeId,
      templateRevision: before.templateRevision,
      waveIndex: 0,
    });
    expect(graph.goal.config!.rollout!.spec?.recipeOutline).toBe(
      '换 replica，并让 PR 过 codex review 和 CI',
    );
    // Each experiment runs again as a new task that continues its earlier run.
    expect(state.probeNodeIds).toHaveLength(probeIds.length);
    expect(state.probeNodeIds.some((id) => probeIds.includes(id))).toBe(false);
    const reruns = state.probeNodeIds.map((id) => graph.nodes.find((node) => node.id === id)!);
    expect(reruns.map((node) => node.status)).not.toContain('resolved');
    expect(reruns[0].description).toContain('每个 PR 都要过 codex review 和 CI');
    expect(await Promise.all(state.probeNodeIds.map((id) => derivedFrom(goalId, id)))).toEqual(
      probeIds,
    );
    const gated = graph.edges
      .filter((edge) => edge.kind === 'depends_on' && edge.sourceNodeId === before.assayNodeId)
      .map((edge) => edge.targetNodeId);
    expect(gated).toEqual(expect.arrayContaining(state.probeNodeIds));
    // Units already delivered keep their delivery.
    for (const id of probeIds)
      expect(graph.nodes.find((node) => node.id === id)!.status).toBe('resolved');

    // Once the re-runs settle, the owner reviews their results on the same report,
    // named by the plan they ran on rather than the round number.
    for (const id of state.probeNodeIds) await graphModel.updateNodeStatus(goalId, id, 'resolved');
    await service.tick(goalId);
    const revised = (await service.graph(goalId)).goal.config!.rolloutState!;
    const planVersion = revised.planVersions?.[String(revised.templateRevision)];
    expect(planVersion).toBeGreaterThan(revised.templateRevision);
    expect((await pendingRelease(service, goalId))!.question).toContain(
      `Experiments of v${planVersion} finished`,
    );
    const rounds = await new VerifyRunModel(serverDB, userId).listByAcceptance(
      before.releaseGateAcceptanceId!,
    );
    expect(rounds.at(-1)!.metadata!.releaseGate!.units.map((unit) => unit.nodeId)).toEqual(
      state.probeNodeIds,
    );
  });

  // A probe that built on another runs after it again: the re-runs keep the
  // order, so the dependent one never starts on its prerequisite's old output.
  it('keeps the order between probes that depended on each other', async () => {
    const { goalId, graphModel, probeIds, service } = await passedProbes();
    await graphModel.createEdge(goalId, probeIds[1], probeIds[0], 'depends_on');
    await service.tick(goalId);

    await sendBackAndRewrite(service, goalId);

    const graph = await service.graph(goalId);
    const [first, second] = graph.goal.config!.rolloutState!.probeNodeIds;
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === 'depends_on' && edge.sourceNodeId === second && edge.targetNodeId === first,
      ),
    ).toBe(true);
  });

  it('re-runs only the units the main Agent names', async () => {
    const { goalId, probeIds, service } = await passedProbes();
    await service.tick(goalId);

    await sendBackAndRewrite(service, goalId, [probeIds[0], 'Unit 2']);

    const state = (await service.graph(goalId)).goal.config!.rolloutState!;
    // The named units are replaced in place by their re-runs; the rest stand.
    expect(state.probeNodeIds).toHaveLength(probeIds.length);
    expect(
      await Promise.all(state.probeNodeIds.slice(0, 2).map((id) => derivedFrom(goalId, id))),
    ).toEqual(probeIds.slice(0, 2));
    expect(state.probeNodeIds.slice(2)).toEqual(probeIds.slice(2));
    expect(state.releasedCount).toBe(probeIds.length);
  });

  it('returns a rewrite that re-runs nothing straight to the review', async () => {
    const { goalId, probeIds, service } = await passedProbes();
    await service.tick(goalId);
    const before = (await service.graph(goalId)).goal.config!.rolloutState!;

    await sendBackAndRewrite(service, goalId, []);

    const state = (await service.graph(goalId)).goal.config!.rolloutState!;
    expect(state).toMatchObject({
      phase: 'release_review',
      probeNodeIds: probeIds,
      templateRevision: before.templateRevision,
    });
    expect(await pendingRelease(service, goalId)).toBeDefined();
  });

  it('re-runs a later wave sent back in place, and returns its results to the owner', async () => {
    const { goalId, graphModel, service } = await firstWaveDelivered();
    // The owner reviews the later wave (escalated by the main Agent in practice).
    await service.tick(goalId);
    const before = (await service.graph(goalId)).goal.config!.rolloutState!;
    const reviewed = before.massNodeIds!;

    await sendBackAndRewrite(service, goalId);

    const state = (await service.graph(goalId)).goal.config!.rolloutState!;
    expect(state).toMatchObject({ phase: 'mass', waveIndex: before.waveIndex });
    expect(await Promise.all(state.massNodeIds!.map((id) => derivedFrom(goalId, id)))).toEqual(
      reviewed,
    );

    // The re-run wave passes its gate. A main Agent that could release later
    // waves on its own is not asked: the owner sent this one back.
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
    for (const id of state.massNodeIds!) await graphModel.updateNodeStatus(goalId, id, 'resolved');
    await service.tick(goalId);

    expect(execAgent).not.toHaveBeenCalled();
    expect((await pendingRelease(service, goalId))!.question).toContain('re-run on plan');
  });

  // The review report may fail to open; the owner then sends the wave back on
  // the goal page. The re-run still returns to the owner, not the main Agent.
  it('returns a later wave sent back on the goal page to the owner', async () => {
    const { goalId, graphModel, service } = await firstWaveDelivered();
    await service.tick(goalId);
    const held = (await service.graph(goalId)).goal.config!.rolloutState!;
    const goalModel = new GoalModel(serverDB, userId);
    await goalModel.updateRolloutState(goalId, { ...held, releaseGateAcceptanceId: undefined });
    const pending = await pendingRelease(service, goalId);
    await service.decide(goalId, pending!.id, 'revise', '每个 PR 都要过 codex review 和 CI');
    const revising = (await service.graph(goalId)).goal.config!.rolloutState!;
    await goalModel.updateRolloutState(goalId, {
      ...revising,
      pendingRevision: {
        ...revising.pendingRevision!,
        revisedRecipe: '换 replica，过 review 和 CI',
      },
    });
    await service.tick(goalId);

    const agentId = 'goal-release-fallback-agent';
    await serverDB.insert(agents).values({ id: agentId, userId });
    const config = (await service.graph(goalId)).goal.config!;
    await serverDB
      .update(goals)
      .set({ agentId, config: { ...config, manager: { maxTurns: 4 } } })
      .where(eq(goals.id, goalId));
    const execAgent = vi.spyOn(AiAgentService.prototype, 'execAgent').mockResolvedValue({
      operationId: 'op-release-turn',
    } as Awaited<ReturnType<AiAgentService['execAgent']>>);
    const rerun = (await service.graph(goalId)).goal.config!.rolloutState!;
    for (const id of rerun.massNodeIds!) await graphModel.updateNodeStatus(goalId, id, 'resolved');
    await service.tick(goalId);

    expect(execAgent).not.toHaveBeenCalled();
    expect((await pendingRelease(service, goalId))!.question).toContain('re-run on plan');
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
