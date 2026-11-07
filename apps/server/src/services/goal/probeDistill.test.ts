// @vitest-environment node
import type { GoalConfig } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { agents, goalNodes, goals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { UserSkillService } from '@/server/services/userSkill';

import { GoalService } from './index';
import { GoalManagerService } from './manager';
import { GoalProbeDistill } from './probeDistill';
import * as scheduler from './scheduler';
import {
  answerDistill,
  distillTurn,
  pendingRelease,
  registerGoalServiceTestCleanup,
} from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const userId = 'goal-probe-distill-test-user';
const agentId = 'goal-probe-distill-agent';

const service = () => new GoalService(db, userId);
const manager = () => new GoalManagerService(db, userId);
const model = () => new GoalModel(db, userId);
const ops = () => new AgentOperationModel(db, userId);

registerGoalServiceTestCleanup(db, userId);

let seq = 0;
beforeEach(async () => {
  await db.insert(agents).values({ id: agentId, userId });
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const operationId = `op-distill-${++seq}`;
    const topicId = params.appContext!.topicId!;
    await ops().recordStart({
      agentId: params.agentId,
      appContext: { sourceMessageId: params.clientIds?.userMessageId },
      operationId,
      topicId,
    });
    return { operationId, topicId } as Awaited<ReturnType<AiAgentService['execAgent']>>;
  });
});

const recipe = 'Persist the resource, show stale data first, revalidate, add a regression test';
const batchPlan = {
  action: 'tasks' as const,
  reason: 'Four resources share one caching recipe',
  rollout: { recipe, units: ['Project skills', 'Home inbox'] },
  tasks: [
    { description: 'Persist device:listDevices; online state unknown', title: 'Device list' },
    { description: 'Persist toolResultPayload in IndexedDB, capped', title: 'Tool payload' },
  ],
};
const distilled = `${recipe}\n\n## Pitfalls the probes hit\n- Scope the persisted key by workspace before hydrating`;

/** A goal whose main Agent declared the batch and whose probes just settled. */
const probesSettled = async (
  status: 'rejected' | 'resolved' = 'resolved',
  config: Partial<GoalConfig> = {},
) => {
  const graph = await service().create({
    config: { manager: { maxTurns: 4 } },
    createdByAgentId: agentId,
    title: 'Cache resources',
  });
  const id = graph.goal.id;
  // Supervision would take a failed probe first; this file covers the batch path.
  await db
    .update(goals)
    .set({ config: { manager: { maxTurns: 4 }, ...config } })
    .where(eq(goals.id, id));
  await service().tick(id);
  const first = (await model().findById(id))!.config!.managerState!;
  const op = await ops().findByTopicSourceMessage(first.topicId, `msg_goal_manager_${first.token}`);
  await manager().submit(id, first.token, op!.id, batchPlan);
  await ops().recordCompletion(op!.id, { status: 'done' });
  await service().tick(id);
  const probeIds = (await model().findById(id))!.config!.rolloutState!.probeNodeIds;
  for (const [index, nodeId] of probeIds.entries())
    await db
      .update(goalNodes)
      .set({ status: index === 0 ? status : 'resolved' })
      .where(eq(goalNodes.id, nodeId));
  return { id, probeIds };
};

describe('distilling the plan from settled probes', () => {
  it('hands the settled probes to the main Agent before the gate judges them', async () => {
    const { id, probeIds } = await probesSettled();

    await service().tick(id);

    const config = (await model().findById(id))!.config!;
    expect(config.rolloutState!.phase).toBe('plan_distill');
    // The gate waits on the plan: no release is held for the owner yet.
    expect(await pendingRelease(service(), id)).toBeUndefined();
    const { state } = await distillTurn(db, userId, id);
    for (const probeId of probeIds) expect(state.problem).toContain(probeId);
  });

  it('lands the distilled plan as the plan skill next version, then holds the release on it', async () => {
    const { id, probeIds } = await probesSettled();
    await service().tick(id);
    const { op, state: turn } = await distillTurn(db, userId, id);
    await manager().submit(id, turn.token, op.id, {
      action: 'revise_plan',
      reason: 'Folded the workspace scoping pitfall into step 1',
      recipe: distilled,
    });
    await ops().recordCompletion(op.id, { status: 'done' });
    const phases: string[] = [];
    for (let i = 0; i < 3; i++) {
      await service().tick(id);
      phases.push((await model().findById(id))!.config!.rolloutState!.phase);
    }

    // The distill step hands straight to the gate: never back through `probe`.
    expect(phases).not.toContain('probe');
    expect(phases.at(-1)).toBe('release_review');

    const config = (await model().findById(id))!.config!;
    const state = config.rolloutState!;
    expect(state).toMatchObject({ phase: 'release_review', planVersions: { '1': 2 } });
    expect(state.pendingDistill).toBeUndefined();
    // Every later wave is briefed from the distilled plan, and the skill holds it.
    expect(config.rollout!.spec!.recipeOutline).toBe(distilled);
    const skill = await new UserSkillService(db, userId).getSkill(state.planSkill!.id);
    expect(skill?.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(skill?.content).toContain('Scope the persisted key by workspace');
    const template = (await service().graph(id)).nodes.find((n) => n.id === state.templateNodeId);
    expect(template?.description).toBe(distilled);
    // The probes are not run again; the owner reviews them with the plan they taught.
    expect(state.probeNodeIds).toEqual(probeIds);
    const pending = await pendingRelease(service(), id);
    expect(pending!.question).toContain('Experiments of v2 finished');
    const [round] = await new VerifyRunModel(db, userId).listByAcceptance(
      state.releaseGateAcceptanceId!,
    );
    expect(round.metadata!.releaseGate!.plan.content).toContain('Pitfalls the probes hit');
  });

  it('re-runs the probes the main Agent sends back, then distills the round again', async () => {
    const { id, probeIds } = await probesSettled();
    const [shortProbe, metProbe] = probeIds;
    await service().tick(id);
    const first = await distillTurn(db, userId, id);
    await manager().submit(id, first.state.token, first.op.id, {
      action: 'revise_plan',
      reason: 'Device list stopped at an open PR: CI fails and a P1 review finding is unresolved',
      recipe: distilled,
      rerun: [shortProbe],
    });
    await ops().recordCompletion(first.op.id, { status: 'done' });
    await service().tick(id);
    await service().tick(id);

    // The plan lands, but the gate does not judge the probe sent back.
    const config = (await model().findById(id))!.config!;
    let state = config.rolloutState!;
    expect(state.phase).toBe('probe');
    expect(state.pendingDistill).toBeUndefined();
    expect(state.planVersions).toEqual({ '1': 2 });
    expect(config.rollout!.spec!.recipeOutline).toBe(distilled);
    expect(await pendingRelease(service(), id)).toBeUndefined();

    // The re-run takes the sent-back probe's place, continuing it; the other stays.
    const rerunId = state.probeNodeIds[0];
    expect(rerunId).not.toBe(shortProbe);
    expect(state.probeNodeIds[1]).toBe(metProbe);
    const graph = await service().graph(id);
    const rerun = graph.nodes.find((node) => node.id === rerunId)!;
    expect(rerun.title).toBe('Device list');
    expect(rerun.description).toContain('Persist device:listDevices');
    expect(rerun.description).toContain('a P1 review finding is unresolved');
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === 'derived_from' &&
          edge.sourceNodeId === rerunId &&
          edge.targetNodeId === shortProbe,
      ),
    ).toBe(true);

    // Once the re-run settles, the round goes back to the main Agent before the gate.
    await db.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, rerunId));
    await answerDistill(service(), db, userId, id, distilled);

    state = (await model().findById(id))!.config!.rolloutState!;
    expect(state.phase).toBe('release_review');
    expect(state.probeNodeIds).toEqual([rerunId, metProbe]);
    expect(await pendingRelease(service(), id)).toBeDefined();
  });

  it('distills a round with a broken probe too, before the gate breaks on it', async () => {
    const { id } = await probesSettled('rejected');

    await service().tick(id);
    expect((await model().findById(id))!.config!.rolloutState!.phase).toBe('plan_distill');
    await answerDistill(service(), db, userId, id, distilled);

    const config = (await model().findById(id))!.config!;
    expect(config.rolloutState!.phase).toBe('pattern_break');
    // The person revising the broken round starts from the distilled plan.
    expect(config.rollout!.spec!.recipeOutline).toBe(distilled);
  });

  it('takes only a rewrite on a distill turn, and hands it over again when none came', async () => {
    const { id } = await probesSettled();
    await service().tick(id);
    const first = await distillTurn(db, userId, id);

    await expect(
      manager().submit(id, first.state.token, first.op.id, {
        action: 'release',
        reason: 'The probes look fine',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await ops().recordCompletion(first.op.id, { status: 'done' });
    await service().tick(id);
    await service().tick(id);
    const second = await distillTurn(db, userId, id);
    expect(second.state.token).not.toBe(first.state.token);
    expect((await model().findById(id))!.config!.rolloutState!.phase).toBe('plan_distill');
  });

  it('judges the gate on the plan as written when the main Agent has no turn left', async () => {
    const { id } = await probesSettled('resolved', { manager: { maxTurns: 1 } });

    // One advance: the skipped distill step goes straight on to the gate.
    expect((await service().tick(id)).outcome).toBe('waiting_human');

    const config = (await model().findById(id))!.config!;
    expect(config.rolloutState!.phase).toBe('release_review');
    expect(config.rollout!.spec!.recipeOutline).toBe(recipe);
    expect(config.managerState!.problemKind).toBeUndefined();
  });

  it('keeps the distillation pending while the goal is paused', async () => {
    const { id } = await probesSettled();
    await service().tick(id);
    const first = await distillTurn(db, userId, id);
    await ops().recordCompletion(first.op.id, { status: 'done' });
    await model().updateStatus(id, 'paused');

    // A queued advance runs while paused: the Agent is unavailable, not out of turns.
    await service().tick(id);

    let state = (await model().findById(id))!.config!.rolloutState!;
    expect(state.phase).toBe('plan_distill');
    expect(state.distilledProbes).toBeUndefined();
    expect(await pendingRelease(service(), id)).toBeUndefined();

    // Resumed, the probes go to the main Agent again rather than to the gate.
    await model().updateStatus(id, 'running');
    await service().tick(id);
    await service().tick(id);
    const second = await distillTurn(db, userId, id);
    expect(second.state.token).not.toBe(first.state.token);
    state = (await model().findById(id))!.config!.rolloutState!;
    expect(state.phase).toBe('plan_distill');
  });

  it('writes one plan skill version when two advances land the same rewrite', async () => {
    const { id } = await probesSettled();
    await service().tick(id);
    const { op, state } = await distillTurn(db, userId, id);
    await manager().submit(id, state.token, op.id, {
      action: 'revise_plan',
      reason: 'Folded the workspace scoping pitfall into step 1',
      recipe: distilled,
    });
    await ops().recordCompletion(op.id, { status: 'done' });
    // Settle the turn, so the next advance is the one that lands the rewrite.
    await service().tick(id);
    const before = await service().graph(id);
    expect(before.goal.config!.rolloutState!.pendingDistill).toBeDefined();

    // Two advances read the same pending rewrite; the second lands after the first.
    const distill = new GoalProbeDistill(db, userId, undefined);
    await distill.route(before);
    await distill.route(before);

    const after = (await model().findById(id))!.config!.rolloutState!;
    const skill = await new UserSkillService(db, userId).getSkill(after.planSkill!.id);
    expect(skill?.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(after.planVersions).toEqual({ '1': 2 });
  });
});
