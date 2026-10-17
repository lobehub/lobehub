import type { GoalAdvanceEffect } from '@lobechat/agent-tracing';
import {
  GOAL_BATCH_RELEASE_OPTION,
  GOAL_BATCH_RELEASE_QUESTION_TAIL,
  GOAL_BATCH_RELEASE_TITLE,
  GOAL_COORDINATOR_ACTOR_ID,
  RELEASE_REVIEW_PAUSE_REASON,
  ROLLOUT_WAVE_SIZE_DEFAULT,
} from '@lobechat/const/goal';
import type {
  GoalGraphSnapshot,
  GoalItem,
  GoalPauseReason,
  GoalReleaseGateDossier,
  GoalRolloutState,
  GoalStatus,
  GoalTickResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import type { LobeChatDatabase } from '@/database/type';

import { BatchPlanSkillService } from './batchPlanSkill';
import type { GoalBriefService } from './goalBriefs';
import type { GoalService } from './index';
import { answeredProblem, GoalManagerService, problemKey } from './manager';
import { buildReleaseGateDossier, openReleaseGateAcceptance } from './releaseGate';
import { createRecipeUnitTask } from './rolloutBatch';
import { describeGateChecks, type RolloutGateResult, withGateVerdict } from './rolloutGate';

const log = debug('lobe-server:goal-rollout');

/** Ends a person reached, or the coordinator's verdict of success: nothing reopens these but `resume`. */
const GOAL_ENDED_STATUSES = new Set<string>(['achieved', 'canceled']);

type ReleaseOption = (typeof GOAL_BATCH_RELEASE_OPTION)[keyof typeof GOAL_BATCH_RELEASE_OPTION];

/** What the release review borrows from the goal service that runs it. */
export interface ReleaseReviewHost {
  briefs: GoalBriefService;
  decide: GoalService['decide'];
  graph: GoalService['graph'];
  requireGraph: (goalId: string) => Promise<GoalGraphSnapshot>;
  setPauseReason: (goalId: string, reason: GoalPauseReason | undefined) => Promise<void>;
  transitionStatus: (goal: GoalItem, to: GoalStatus, reason?: string) => Promise<unknown>;
}

/**
 * The batch's release gate as a decision a person (or the main Agent) makes.
 *
 * A passed gate only proves the units ran; releasing the next wave is held
 * here: on the owner for a round's first wave, on the main Agent for the rest.
 * The owner decides on a review report; sending the plan back hands the
 * correction to the main Agent, whose rewrite becomes the plan skill's next
 * version in the same round and comes back to the same review.
 */
export class GoalReleaseReview {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId: string | undefined,
    private readonly host: ReleaseReviewHost,
  ) {}

  /**
   * Decide who releases the wave a passed gate has earned.
   *
   * The gate's checks only prove the units ran through; putting the next wave
   * out is a decision. A round's first mass wave — the move from probes to the
   * class — always waits on a person, who sees the probes' deliveries and the
   * recipe before anything fans out. Every later wave is reported to the main
   * Agent, which releases it or escalates it to the person. A Goal without a
   * main Agent that can take the turn asks the person instead of releasing on
   * its own. The final pass with the roster exhausted closes the batch directly:
   * there is nothing left to release.
   */
  routeRolloutRelease = async (
    graph: GoalGraphSnapshot,
    effects: GoalAdvanceEffect[],
    gate?: RolloutGateResult,
  ): Promise<GoalTickResult> => {
    const policy = graph.goal.config?.rollout;
    const state = graph.goal.config?.rolloutState;
    if (!policy || !state) return this.releaseRolloutWave(graph, effects, gate);

    const released = state.releasedCount ?? state.probeNodeIds.length;
    const waveSize = Math.max(1, policy.waveSize ?? ROLLOUT_WAVE_SIZE_DEFAULT);
    const waveCount = (state.unitTitles ?? []).slice(released, released + waveSize).length;
    if (!waveCount) return this.releaseRolloutWave(graph, effects, gate);

    const approval = state.releaseApproval;
    if (
      approval &&
      approval.revision === state.templateRevision &&
      approval.waveIndex === state.waveIndex
    )
      return this.releaseRolloutWave(graph, effects, gate);

    const wave = `wave ${state.waveIndex + 1} (${waveCount} unit${waveCount === 1 ? '' : 's'})`;
    if (state.waveIndex === 0)
      return this.openReleaseReview(
        graph,
        `Experiments of v${state.templateRevision} finished; start batch execution with ${wave}`,
        effects,
        { gate, kind: 'probes' },
      );

    // The key names the round and the wave, so an answer for one wave is never
    // read as the answer for the next.
    const problem = {
      kind: 'rollout_release' as const,
      reason: `Batch gate passed for v${state.templateRevision} after wave ${state.waveIndex}: ${describeGateChecks(gate)}. Decide whether ${wave} goes out — release it, or escalate it for the owner to approve.`,
    };
    const answered = answeredProblem(graph.goal.config?.managerState);
    // A `release` answer recorded its approval when it was submitted, so reaching
    // here with this problem answered means the Agent did not release it.
    if (answered?.key === problemKey(problem))
      return this.openReleaseReview(
        graph,
        `The main Agent asked you to approve releasing ${wave}`,
        effects,
        { diagnosis: answered.reason, gate, kind: 'escalated' },
      );
    const takeover = await new GoalManagerService(this.db, this.userId, this.workspaceId).takeOver(
      graph,
      problem,
    );
    if (takeover) return takeover;
    return this.openReleaseReview(
      graph,
      `Batch gate passed and no main Agent could review the release; approve releasing ${wave}`,
      effects,
      { gate, kind: 'unattended' },
    );
  };

  /**
   * Hold a passed batch gate for a person's approval.
   *
   * Parks the goal like a pattern break, but on a decision node of its own: a
   * node carries one decision, and the Assay keeps its for a break later in the
   * round. `release` sends the wave out on the proven recipe; `revise` takes a
   * correction for the main Agent, whose rewritten plan comes back to this
   * review — the probes already ran and are not run again.
   */
  private openReleaseReview = async (
    graph: GoalGraphSnapshot,
    message: string,
    effects: GoalAdvanceEffect[],
    review: {
      /** The main Agent's reasoning when it escalated the release. */
      diagnosis?: string;
      gate?: RolloutGateResult;
      kind: GoalReleaseGateDossier['kind'];
    },
  ): Promise<GoalTickResult> => {
    const { diagnosis } = review;
    const goalId = graph.goal.id;
    const question = `${message}\n\n${GOAL_BATCH_RELEASE_QUESTION_TAIL}`;
    const reason = `${RELEASE_REVIEW_PAUSE_REASON}: ${message}`;
    // Same claim as the pattern break: overlapping advances can both see the
    // passed gate, and only the first may open the question.
    const claim = await this.db.transaction(async (tx) => {
      const goalModel = new GoalModel(tx, this.userId, this.workspaceId);
      const locked = await goalModel.lockById(goalId);
      const current = locked?.config?.rolloutState;
      if (!locked || !current) return undefined;
      if (current.phase === 'release_review')
        return { gateNodeId: current.releaseReviewNodeId, opened: false as const };
      if (
        current.phase !== graph.goal.config?.rolloutState?.phase ||
        current.waveIndex !== graph.goal.config?.rolloutState?.waveIndex
      )
        return undefined;
      const writer = new GoalGraphModel(tx, this.userId, this.workspaceId, {
        id: GOAL_COORDINATOR_ACTOR_ID,
        type: 'system',
      });
      const node = await writer.createNode(goalId, {
        // What the person decides on: the coordinator's reason, and the main
        // Agent's own when it brought the release back.
        description: diagnosis ? `${message}\n\nMain Agent: ${diagnosis}` : message,
        kind: 'decision',
        scopeId: current.batchNodeId,
        status: 'waiting',
        title: GOAL_BATCH_RELEASE_TITLE,
      });
      if (!node) return undefined;
      if (current.assayNodeId)
        await writer.createEdge(goalId, current.assayNodeId, node.id, 'leads_to');
      const decision = await writer.createDecision(goalId, node.id, {
        authority: 'user',
        options: [
          { id: GOAL_BATCH_RELEASE_OPTION.release, label: 'Release the next wave' },
          { id: GOAL_BATCH_RELEASE_OPTION.revise, label: 'Send the plan back to the main Agent' },
        ],
        question,
        recommendedOptionId: GOAL_BATCH_RELEASE_OPTION.release,
        requestedUserId: this.userId,
      });
      await goalModel.updateRolloutState(goalId, {
        ...current,
        phase: 'release_review',
        releaseApproval: undefined,
        releaseReviewNodeId: node.id,
      });
      await goalModel.updatePauseReason(goalId, 'release_review');
      if (locked.status !== 'paused' && !GOAL_ENDED_STATUSES.has(locked.status)) {
        await goalModel.updateStatus(goalId, 'paused');
        await writer
          .recordGoalStatus(goalId, locked.status, 'paused', reason)
          .catch((error) =>
            console.error('[GoalReleaseReview] failed to record goal status:', error),
          );
      }
      return { decisionId: decision?.id, gateNodeId: node.id, opened: true as const };
    });
    if (!claim) return { goalId, message, outcome: 'waiting_human' };
    if (!claim.opened)
      return { goalId, message, nodeId: claim.gateNodeId, outcome: 'waiting_human' };
    effects.push({
      detail: message,
      nodeId: claim.gateNodeId,
      targetId: claim.decisionId ?? claim.gateNodeId,
      type: 'opened_decision',
    });
    // The review report first, so the brief can open it: approving the class
    // is a full review, not a one-click answer from Home.
    const reviewAcceptanceId = claim.gateNodeId
      ? await this.openReleaseGate(goalId, claim.gateNodeId, review)
      : undefined;
    if (claim.decisionId)
      await this.host.briefs.openDecision(graph.goal, {
        decisionId: claim.decisionId,
        options: [],
        question,
        reviewAcceptanceId,
      });
    effects.push({ type: 'goal_status', detail: 'paused: release_review' });
    return { goalId, message, nodeId: claim.gateNodeId, outcome: 'waiting_human' };
  };

  /**
   * Give a held release its review page: an acceptance carrying what the owner
   * decides on. Best-effort — without it the gate still holds the goal and the
   * owner answers it on the goal page.
   */
  private openReleaseGate = async (
    goalId: string,
    gateNodeId: string,
    review: { diagnosis?: string; gate?: RolloutGateResult; kind: GoalReleaseGateDossier['kind'] },
  ): Promise<string | undefined> => {
    try {
      const graph = await this.host.graph(goalId);
      const dossier = buildReleaseGateDossier(graph, {
        diagnosis: review.diagnosis,
        gate: review.gate,
        kind: review.kind,
        waveSize: Math.max(1, graph.goal.config?.rollout?.waveSize ?? ROLLOUT_WAVE_SIZE_DEFAULT),
      });
      if (!dossier) return undefined;
      // A plan rewritten after a send-back is reviewed on the same report, as
      // its next round: the owner sees the send-back and the rewrite together.
      const acceptanceId = await openReleaseGateAcceptance(
        this.db,
        { userId: this.userId, workspaceId: this.workspaceId },
        gateNodeId,
        dossier,
        graph.goal.config?.rolloutState?.releaseGateAcceptanceId,
      );
      await this.db.transaction(async (tx) => {
        const goalModel = new GoalModel(tx, this.userId, this.workspaceId);
        const current = (await goalModel.lockById(goalId))?.config?.rolloutState;
        if (current?.phase !== 'release_review' || current.releaseReviewNodeId !== gateNodeId)
          return;
        await goalModel.updateRolloutState(goalId, {
          ...current,
          releaseGateAcceptanceId: acceptanceId,
        });
      });
      return acceptanceId;
    } catch (error) {
      console.error('[GoalReleaseReview] failed to open the release gate review:', error);
      return undefined;
    }
  };

  /**
   * Answer a held release from its review page. The acceptance's decision is
   * the owner's: `release` sends the wave out, `revise` sends the plan back to
   * the main Agent with the correction. Returns the goal it moved.
   */
  answerReleaseGate = async (
    subjectNodeId: string,
    optionId: ReleaseOption,
    resolution?: string,
  ): Promise<string> => {
    const goal = await new GoalModel(this.db, this.userId, this.workspaceId).findByNode(
      subjectNodeId,
    );
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    const graph = await this.host.requireGraph(goal.id);
    // A plan rewritten after a send-back is reviewed again on the same report,
    // whose subject is still the first review's node: answer the one now held.
    const heldNodeId = graph.goal.config?.rolloutState?.releaseReviewNodeId;
    const decision =
      graph.decisions.find((item) => item.nodeId === subjectNodeId && item.status === 'pending') ??
      graph.decisions.find((item) => item.nodeId === heldNodeId && item.status === 'pending');
    if (!decision) {
      // The goal took this answer but the report's own write did not land (a
      // failed or interrupted request): a retry of the same answer finishes it.
      const answered = this.answeredRelease(graph, optionId);
      if (answered) {
        await this.host.briefs.settleDecision(answered.id, optionId, resolution);
        return goal.id;
      }
      throw new TRPCError({ code: 'CONFLICT', message: 'This release was already decided' });
    }
    const gateNodeId = decision.nodeId;
    // The plan is the main Agent's: a correction always goes to it to rewrite.
    if (optionId === GOAL_BATCH_RELEASE_OPTION.revise)
      await this.sendRevisionToAgent(goal.id, gateNodeId, decision.id, resolution);
    else
      await this.host.decide(goal.id, decision.id, optionId, resolution, { fromReleaseGate: true });
    // The inbox asked the same release; it is answered now.
    await this.host.briefs.settleDecision(decision.id, optionId, resolution);
    return goal.id;
  };

  /**
   * The goal's latest held release, when it was already answered with
   * `optionId`. A rewritten plan is held on a later node than the report's
   * subject, so the newest release decision is the one the report last asked.
   */
  private answeredRelease = (graph: GoalGraphSnapshot, optionId: ReleaseOption) => {
    const releaseNodeIds = new Set(
      graph.nodes.filter((node) => node.title === GOAL_BATCH_RELEASE_TITLE).map((node) => node.id),
    );
    const latest = graph.decisions
      .filter((item) => releaseNodeIds.has(item.nodeId))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .at(-1);
    return latest?.status === 'resolved' && latest.resolvedOptionId === optionId
      ? latest
      : undefined;
  };

  /**
   * The owner sent the plan back. The correction goes to the main Agent, which
   * rewrites the plan before the next probe round runs on it — a correction is
   * an instruction to the planner, not a note to paste under the plan. The
   * answer, the hand-off and the resumed goal commit together.
   */
  sendRevisionToAgent = async (
    goalId: string,
    gateNodeId: string,
    decisionId: string,
    resolution: string | undefined,
  ) => {
    const correction = resolution?.trim();
    if (!correction)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Revising the recipe needs a correction',
      });
    const moved = await this.db.transaction(async (tx) => {
      const goalModel = new GoalModel(tx, this.userId, this.workspaceId);
      const locked = await goalModel.lockById(goalId);
      const current = locked?.config?.rolloutState;
      if (
        !locked ||
        current?.phase !== 'release_review' ||
        current.releaseReviewNodeId !== gateNodeId
      )
        return false;
      const writer = new GoalGraphModel(tx, this.userId, this.workspaceId, {
        id: GOAL_COORDINATOR_ACTOR_ID,
        type: 'system',
      });
      const resolved = await new GoalGraphModel(tx, this.userId, this.workspaceId).resolveDecision(
        goalId,
        decisionId,
        GOAL_BATCH_RELEASE_OPTION.revise,
        correction,
      );
      if (!resolved) return false;
      await writer.updateNodeStatus(
        goalId,
        gateNodeId,
        'resolved',
        'Plan sent back to the main Agent',
      );
      await goalModel.updateRolloutState(goalId, {
        ...current,
        pendingRevision: { correction },
        phase: 'plan_revision',
        releaseApproval: undefined,
      });
      await goalModel.updatePauseReason(goalId, undefined);
      if (locked.status === 'paused') {
        await goalModel.updateStatus(goalId, 'running');
        await writer
          .recordGoalStatus(goalId, 'paused', 'running', 'Plan sent back to the main Agent')
          .catch((error) =>
            console.error('[GoalReleaseReview] failed to record goal status:', error),
          );
      }
      return true;
    });
    if (!moved)
      throw new TRPCError({ code: 'CONFLICT', message: 'This release was already decided' });
    return true;
  };

  /**
   * Drive a sent-back plan to its rewrite. The plan is the main Agent's to
   * write: its submitted rewrite becomes the new version of the plan. A turn that
   * ended without one is handed over again; when no turn can be started (no
   * main Agent, turn budget spent) the goal pauses and says so — the correction
   * is never pasted under the plan in the Agent's place.
   */
  routeRolloutRevision = async (graph: GoalGraphSnapshot): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;
    const state = graph.goal.config!.rolloutState!;
    const pending = state.pendingRevision ?? { correction: '' };
    if (pending.revisedRecipe) return this.applyPlanRevision(graph);

    const problem = {
      kind: 'rollout_revise' as const,
      reason: `The owner reviewed the experiments of plan v${state.templateRevision} and sent the plan back with this correction:\n${pending.correction}\nRewrite the plan so every remaining unit follows it, and answer revise_plan with the full revised plan.`,
    };
    const takeover = await new GoalManagerService(this.db, this.userId, this.workspaceId).takeOver(
      graph,
      problem,
    );
    if (takeover) return takeover;
    const message =
      'The main Agent could not take the plan revision; resume the goal once it can, and the correction goes to it again';
    await this.host.transitionStatus(graph.goal, 'paused', message);
    return { goalId, message, outcome: 'waiting_human' };
  };

  /**
   * Land the main Agent's rewrite in the round it was asked for. Sending a plan
   * back revises the plan skill — a new version of the same round — not the
   * experiments: they already ran, and the owner judged them. The rewritten
   * plan then returns to the owner on the same release review, as its next
   * round, so the decision is made on the plan the batch will actually copy.
   */
  private applyPlanRevision = async (graph: GoalGraphSnapshot): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;
    const policy = graph.goal.config?.rollout;
    const state = graph.goal.config!.rolloutState!;
    const pending = state.pendingRevision!;
    const recipe = pending.revisedRecipe!.trim();
    const round = String(state.templateRevision);
    const version = state.planSkill
      ? await new BatchPlanSkillService(this.db, this.userId, this.workspaceId)
          .revise(state.planSkill, {
            goalId,
            guidance: pending.correction,
            plan: recipe,
            revision: state.templateRevision,
          })
          .catch((error) => {
            log('applyPlanRevision: plan skill revision failed: %O', error);
            return undefined;
          })
      : undefined;
    const applied = await this.db.transaction(async (tx) => {
      const goalModel = new GoalModel(tx, this.userId, this.workspaceId);
      const current = (await goalModel.lockById(goalId))?.config?.rolloutState;
      if (current?.phase !== 'plan_revision' || !current.pendingRevision?.revisedRecipe)
        return false;
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
      await goalModel.updateRolloutState(goalId, {
        ...current,
        pendingRevision: undefined,
        phase: current.waveIndex === 0 ? 'probe' : 'mass',
        // A revision that did not land leaves the skill on the plan the owner
        // sent back: units drop it and copy the revised plan instead.
        planSkill: version === undefined ? undefined : current.planSkill,
        planVersions: version
          ? { ...current.planVersions, [round]: version }
          : current.planVersions,
      });
      return true;
    });
    if (!applied)
      return { goalId, message: 'The plan revision was already applied', outcome: 'no_progress' };

    const fresh = await this.host.requireGraph(goalId);
    const freshState = fresh.goal.config!.rolloutState!;
    const released = freshState.releasedCount ?? freshState.probeNodeIds.length;
    const waveSize = Math.max(1, policy?.waveSize ?? ROLLOUT_WAVE_SIZE_DEFAULT);
    const count = (freshState.unitTitles ?? []).slice(released, released + waveSize).length;
    const wave = `wave ${freshState.waveIndex + 1} (${count} unit${count === 1 ? '' : 's'})`;
    return this.openReleaseReview(
      fresh,
      `The main Agent revised the plan to v${version ?? freshState.templateRevision} from your correction; approve releasing ${wave}`,
      [],
      {
        diagnosis: pending.revisedReason,
        kind: freshState.waveIndex === 0 ? 'probes' : 'escalated',
      },
    );
  };

  /**
   * A person approved the release a passed gate was held for. The answer and
   * the approval commit together under the goal row's lock; the next advance
   * releases the wave on it.
   */
  approveRolloutRelease = async (
    goalId: string,
    decisionId: string,
    optionId: string,
    resolution: string | undefined,
  ) => {
    const resolved = await this.db.transaction(async (tx) => {
      const goalModel = new GoalModel(tx, this.userId, this.workspaceId);
      const current = (await goalModel.lockById(goalId))?.config?.rolloutState;
      if (current?.phase !== 'release_review') return undefined;
      const answered = await new GoalGraphModel(tx, this.userId, this.workspaceId).resolveDecision(
        goalId,
        decisionId,
        optionId,
        resolution,
      );
      if (!answered) return undefined;
      if (current.releaseReviewNodeId)
        await new GoalGraphModel(tx, this.userId, this.workspaceId, {
          id: GOAL_COORDINATOR_ACTOR_ID,
          type: 'system',
        }).updateNodeStatus(goalId, current.releaseReviewNodeId, 'resolved', 'Release approved');
      await goalModel.updateRolloutState(goalId, {
        ...current,
        phase: current.waveIndex === 0 ? 'probe' : 'mass',
        releaseGateAcceptanceId: undefined,
        releaseReviewNodeId: undefined,
        releaseApproval: {
          at: new Date().toISOString(),
          by: 'user',
          ...(resolution?.trim() && { reason: resolution.trim() }),
          revision: current.templateRevision,
          waveIndex: current.waveIndex,
        },
      });
      return answered;
    });
    if (resolved) await this.host.setPauseReason(goalId, undefined);
    return resolved;
  };

  /** Release the next wave of a repeated batch once its gate passed. */
  private releaseRolloutWave = async (
    graph: GoalGraphSnapshot,
    effects: GoalAdvanceEffect[],
    gate?: RolloutGateResult,
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;
    const policy = graph.goal.config?.rollout;
    const state = graph.goal.config?.rolloutState;
    if (!policy || !state)
      return { goalId, message: 'Batch state missing; nothing to release', outcome: 'no_progress' };

    const roster = state.unitTitles ?? [];
    const released = state.releasedCount ?? state.probeNodeIds.length;
    const waveSize = Math.max(1, policy.waveSize ?? ROLLOUT_WAVE_SIZE_DEFAULT);
    const wave = roster.slice(released, released + waveSize);

    if (!wave.length) {
      await new GoalModel(this.db, this.userId, this.workspaceId).updateRolloutState(goalId, {
        ...state,
        phase: 'done',
      });
      return { goalId, message: 'Batch roster exhausted', outcome: 'advanced' };
    }

    // Advances overlap — two settling tasks can each queue one — and both
    // would read the same cursor and release the same wave twice. Claim it:
    // under the goal row's lock, release only if the cursor is still where this
    // advance read it.
    const created: GoalAdvanceEffect[] = [];
    const message = await this.db.transaction(async (tx) => {
      const goalModel = new GoalModel(tx, this.userId, this.workspaceId);
      const current = (await goalModel.lockById(goalId))?.config?.rolloutState;
      if (
        !current ||
        current.phase !== state.phase ||
        current.waveIndex !== state.waveIndex ||
        (current.releasedCount ?? current.probeNodeIds.length) !== released
      )
        return undefined;
      const writer = new GoalGraphModel(tx, this.userId, this.workspaceId, {
        id: GOAL_COORDINATOR_ACTOR_ID,
        type: 'system',
      });

      const newIds: string[] = [];
      for (const title of wave) {
        const nodeId = await createRecipeUnitTask(
          writer,
          goalId,
          state.batchNodeId,
          title,
          { outline: policy.spec?.recipeOutline, skill: state.planSkill },
          policy.unitBriefs?.[title],
        );
        if (nodeId) {
          newIds.push(nodeId);
          created.push({ detail: title, nodeId, type: 'created_node' });
        }
      }

      const message = `Batch gate passed; released wave ${state.waveIndex + 1} (${newIds.length} unit${newIds.length === 1 ? '' : 's'})`;
      // A batch that predates the counter has no `gateLog` either, and a restart
      // resets `waveIndex`; the roster position still says how many waves are out:
      // everything released beyond the first canary went out a wave at a time.
      const waveNumber =
        (state.wavesReleased ??
          Math.max(
            state.waveIndex,
            (state.gateLog ?? []).filter((entry) => entry.outcome === 'released').length,
            Math.ceil(Math.max(0, released - (policy.canarySize ?? 0)) / waveSize),
          )) + 1;
      const next: GoalRolloutState = withGateVerdict(
        {
          ...state,
          massNodeIds: [...(state.massNodeIds ?? []), ...newIds],
          phase: 'mass',
          // Spent on this wave; the next one needs its own.
          releaseApproval: undefined,
          releasedCount: released + newIds.length,
          waveIndex: state.waveIndex + 1,
          wavesReleased: waveNumber,
        },
        {
          approvedBy: state.releaseApproval?.by,
          checks: gate?.checks ?? [],
          message,
          outcome: 'released',
          releasedCount: newIds.length,
          revision: state.templateRevision,
          trigger: 'gate',
          wave: waveNumber,
          waveIndex: state.waveIndex + 1,
        },
      );
      // Even the final wave stays `mass`: the gate still judges it once it
      // settles, and only a pass with the roster exhausted closes the batch.
      await goalModel.updateRolloutState(goalId, next);
      return message;
    });

    if (!message)
      return {
        goalId,
        message: 'Another advance already released this wave',
        outcome: 'no_progress',
      };
    effects.push(...created);
    return { goalId, message, outcome: 'advanced' };
  };
}
