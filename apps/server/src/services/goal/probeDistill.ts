import { GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';
import type { GoalGraphSnapshot, GoalRolloutState, GoalTickResult } from '@lobechat/types';
import debug from 'debug';

import { GoalGraphModel } from '@/database/models/goalGraph';
import { GoalRepository } from '@/database/repositories/goal';
import type { LobeChatDatabase } from '@/database/type';

import { BatchPlanSkillService } from './batchPlanSkill';
import { GoalManagerService } from './manager';
import { activeStatuses } from './manager/turnState';
import { deliveredUnits, pickRerunUnits, reopenRoundUnits, rerunUnitNote } from './rolloutBatch';

const log = debug('lobe-server:goal-rollout');

/** Node states that mean a probe will never produce again. */
const SETTLED_NODE_STATUSES = new Set(['resolved', 'rejected', 'retired']);

/**
 * Names one set of probes. A round's probes are distilled once; probes a
 * send-back re-runs, or a break re-opens, are new nodes and so a new set.
 */
export const probeSetKey = (state: Pick<GoalRolloutState, 'probeNodeIds'>) =>
  state.probeNodeIds.toSorted().join(',');

/**
 * Whether the round's probes have taught the plan — distilled, or skipped for
 * want of a main Agent turn — so the gate judges them now. The rollout stays
 * in `plan_distill` until the gate moves it on: there is no step in between.
 */
export const probesDistilled = (state: GoalRolloutState) =>
  state.phase === 'plan_distill' && state.distilledProbes === probeSetKey(state);

/**
 * Whether a round's settled probes are owed (or are in) the distill step
 * before the gate judges them. Only the probe wave is distilled — it is where
 * the plan meets real units first — and only on a goal whose main Agent can
 * rewrite it.
 */
export const needsProbeDistill = (graph: GoalGraphSnapshot): boolean => {
  const state = graph.goal.config?.rolloutState;
  if (!graph.goal.config?.rollout || !state) return false;
  if (state.phase === 'plan_distill') return true;
  if (state.phase !== 'probe' || state.waveIndex !== 0 || !state.probeNodeIds.length) return false;
  if (!graph.goal.config.manager || !graph.goal.agentId) return false;
  if (state.distilledProbes === probeSetKey(state)) return false;
  // A person's open question comes first: the gate would not be judged either.
  if (graph.decisions.some((decision) => decision.status === 'pending')) return false;
  const probes = graph.nodes.filter((node) => state.probeNodeIds.includes(node.id));
  return probes.length > 0 && probes.every((node) => SETTLED_NODE_STATUSES.has(node.status));
};

/** The plan version a round runs on (see `GoalRolloutState.planVersions`). */
const planVersionOf = (state: GoalRolloutState) =>
  state.planVersions?.[String(state.templateRevision)] ?? state.templateRevision;

/**
 * The step between a round's settled probes and its gate: the main Agent reads
 * what the probes ran into and rewrites the plan skill from it, so the owner
 * reviews the probes against the plan they taught and every later wave runs on
 * it. A probe whose delivery falls short of that plan — it skipped a step the
 * plan calls done, its review or CI is still open — the main Agent sends back:
 * it runs again on the plan, continuing its delivery, and the round is
 * distilled again once it settles, before the gate judges it. A goal whose main Agent cannot take the
 * turn (no turns or budget left) keeps its plan as written and goes on to the
 * gate rather than stopping on it.
 */
export class GoalProbeDistill {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId: string | undefined,
  ) {}

  /**
   * Drive the distill step. Returns the tick result while it waits on the main
   * Agent, or once it sent probes back to run again; `undefined` once the plan
   * is ready, and the caller judges the gate in the same advance — straight
   * from `plan_distill`, never back through `probe`.
   */
  route = async (snapshot: GoalGraphSnapshot): Promise<GoalTickResult | undefined> => {
    let graph = snapshot;
    const goalId = graph.goal.id;
    const state = graph.goal.config!.rolloutState!;
    if (probesDistilled(state)) return undefined;
    if (state.phase === 'plan_distill' && state.pendingDistill) return this.apply(graph);

    if (state.phase !== 'plan_distill') {
      const entered = await this.db.transaction(async (tx) => {
        const goalModel = new GoalRepository(tx, this.userId, this.workspaceId);
        const current = (await goalModel.lockById(goalId))?.config?.rolloutState;
        if (
          current?.phase !== 'probe' ||
          current.waveIndex !== 0 ||
          probeSetKey(current) !== probeSetKey(state)
        )
          return false;
        await goalModel.updateRolloutState(goalId, { ...current, phase: 'plan_distill' });
        return true;
      });
      const fresh = entered
        ? await new GoalGraphModel(this.db, this.userId, this.workspaceId).getGraph(goalId)
        : undefined;
      if (!fresh)
        return {
          goalId,
          message: 'Another advance already moved the probes on',
          outcome: 'no_progress',
        };
      // The turn is claimed against the goal as it now stands, phase included.
      graph = fresh;
    }

    const probes = graph.nodes.filter((node) => state.probeNodeIds.includes(node.id));
    // Names the probe set, so a later round's distillation is never read as
    // already answered by this one.
    const problem = {
      kind: 'rollout_distill' as const,
      reason: `The ${probes.length} probe${probes.length === 1 ? '' : 's'} of plan v${planVersionOf(state)} settled (${probes
        .map((node) => `${node.title} [${node.id}]: ${node.status}`)
        .join('; ')}). Rewrite the plan from what they ran into before the gate judges them.`,
    };
    // Paused, or waiting on a person: the main Agent is unavailable for now,
    // not out of turns, so the distillation stays pending for when it runs again.
    if (
      !activeStatuses.has(graph.goal.status) ||
      graph.decisions.some((decision) => decision.status === 'pending')
    )
      return {
        goalId,
        message: 'The plan waits to be distilled from the probes until the goal runs again',
        outcome: 'waiting_human',
      };
    const takeover = await new GoalManagerService(this.db, this.userId, this.workspaceId).takeOver(
      graph,
      problem,
    );
    if (takeover) return takeover;
    await this.skip(goalId);
    return undefined;
  };

  /** No main Agent can rewrite the plan: the gate judges the probes on it as written. */
  private skip = async (goalId: string) =>
    this.db.transaction(async (tx) => {
      const goalModel = new GoalRepository(tx, this.userId, this.workspaceId);
      const current = (await goalModel.lockById(goalId))?.config?.rolloutState;
      if (current?.phase !== 'plan_distill' || current.pendingDistill) return;
      log('probe distill: no main Agent turn; judging the gate on the plan as written');
      await goalModel.updateRolloutState(goalId, {
        ...current,
        distilledProbes: probeSetKey(current),
      });
    });

  /**
   * Land the plan the main Agent distilled: the plan skill's next version, the
   * policy's outline every later wave is briefed from, and the Template. The
   * round stays in `plan_distill`, marked distilled, for the gate to judge —
   * unless the rewrite sends probes back. Those re-open in place on the new
   * plan and the round returns to `probe`; the re-runs form a new probe set, so
   * the round is distilled again when they settle.
   *
   * The rewrite is claimed under the goal row's lock before the skill is
   * revised, so overlapping advances that read the same pending rewrite write
   * one version, not one each.
   */
  private apply = async (graph: GoalGraphSnapshot): Promise<GoalTickResult | undefined> => {
    const goalId = graph.goal.id;
    const policy = graph.goal.config?.rollout;
    const reopened = await this.db.transaction(async (tx) => {
      const goalModel = new GoalRepository(tx, this.userId, this.workspaceId);
      const current = (await goalModel.lockById(goalId))?.config?.rolloutState;
      // Another advance landed it first; what it decided is next either way.
      if (current?.phase !== 'plan_distill' || !current.pendingDistill) return [];
      const { reason, recipe: raw, rerun: names } = current.pendingDistill;
      const recipe = raw.trim();
      const round = String(current.templateRevision);
      const skill = recipe ? current.planSkill : undefined;
      // A savepoint: a failed revision costs the skill version, not the claim.
      const version = skill
        ? await tx
            .transaction((savepoint) =>
              new BatchPlanSkillService(
                savepoint as unknown as LobeChatDatabase,
                this.userId,
                this.workspaceId,
              ).revise(skill, {
                goalId,
                guidance: reason,
                plan: recipe,
                revision: current.templateRevision,
              }),
            )
            .catch((error) => {
              log('probe distill: plan skill revision failed: %O', error);
              return undefined;
            })
        : undefined;
      // A revision that did not land leaves the skill on the plan before the
      // probes: later units drop it and copy the distilled plan instead.
      const planSkill = skill && version === undefined ? undefined : current.planSkill;
      if (recipe) {
        if (policy)
          await goalModel.updateRolloutPolicy(goalId, {
            ...policy,
            spec: {
              ...policy.spec,
              recipeOutline: recipe,
              repeatable: policy.spec?.repeatable ?? true,
            },
          });
        if (current.templateNodeId)
          await new GoalGraphModel(tx, this.userId, this.workspaceId, {
            id: GOAL_COORDINATOR_ACTOR_ID,
            type: 'system',
          }).updateNodeDescription(goalId, current.templateNodeId, recipe);
      }
      const planVersions = version
        ? { ...current.planVersions, [round]: version }
        : current.planVersions;

      const rerun = pickRerunUnits(deliveredUnits(graph, current.probeNodeIds), names, 'none');
      if (!rerun.length) {
        await goalModel.updateRolloutState(goalId, {
          ...current,
          distilledProbes: probeSetKey(current),
          pendingDistill: undefined,
          planSkill,
          planVersions,
        });
        return [];
      }

      // The re-runs replace the probes they continue, so the round's next
      // distillation and its gate read them, not the deliveries sent back.
      const replaced = await reopenRoundUnits(
        new GoalGraphModel(tx, this.userId, this.workspaceId, {
          id: GOAL_COORDINATOR_ACTOR_ID,
          type: 'system',
        }),
        graph,
        current,
        rerun,
        { outline: recipe || policy?.spec?.recipeOutline, skill: planSkill },
        (unit) => rerunUnitNote(reason, unit.delivered, 'agent'),
      );
      await goalModel.updateRolloutState(goalId, {
        ...current,
        pendingDistill: undefined,
        phase: 'probe',
        planSkill,
        planVersions,
        probeNodeIds: current.probeNodeIds.map((id) => replaced.get(id) ?? id),
      });
      return rerun.filter((unit) => replaced.has(unit.id)).map((unit) => unit.title);
    });
    if (!reopened.length) return undefined;
    log('probe distill: re-running %d probe(s) on the distilled plan', reopened.length);
    return {
      goalId,
      message: `The main Agent distilled the plan from the probes and sent ${reopened.length} back to run again on it before the gate judges them: ${reopened.join(', ')}`,
      outcome: 'advanced',
    };
  };
}
