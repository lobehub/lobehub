import type { GoalAdvanceEffect } from '@lobechat/agent-tracing';
import {
  GOAL_BATCH_ASSAY_TITLE,
  GOAL_BATCH_BREAK_OPTION,
  GOAL_BATCH_BREAK_QUESTION_TAIL,
  GOAL_BATCH_TEMPLATE_TITLE,
  GOAL_COORDINATOR_ACTOR_ID,
  PATTERN_BREAK_PAUSE_REASON,
  ROLLOUT_CANARY_SIZE_DEFAULT,
  ROLLOUT_MAX_CANARY_SIZE,
} from '@lobechat/const/goal';
import type { GoalGraphSnapshot, GoalTickResult } from '@lobechat/types';

import { type ExpertiseCarrier, ExpertiseModel } from '@/database/models/expertise';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { GoalRepository } from '@/database/repositories/goal';

import { BatchPlanSkillService } from '../batchPlanSkill';
import { TERMINAL_NODE_STATUSES } from '../decideNextMove';
import { probesDistilled } from '../probeDistill';
import { carriedUnitBrief, createRecipeUnitTask } from '../rolloutBatch';
import { evaluateRolloutGate, type RolloutGateResult, withGateVerdict } from '../rolloutGate';
import type { GoalServiceContext } from './types';
import { GOAL_ENDED_STATUSES, log } from './utils';

/**
 * Judge a repeated batch's gate, but only once the wave it released has fully
 * settled. Returns undefined when there is nothing to judge: no batch, a batch
 * already through its gate or parked on a pattern break, or a wave still
 * running (the ordinary frontier owns that tick). The final wave is judged
 * like every other — a unit retired or broken in it must stop the batch the
 * same way — and a pass with the roster exhausted closes the batch.
 */
export const collectRolloutGate = (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): RolloutGateResult | undefined => {
  const policy = graph.goal.config?.rollout;
  const state = graph.goal.config?.rolloutState;
  if (
    !policy ||
    !state ||
    state.phase === 'done' ||
    state.phase === 'pattern_break' ||
    state.phase === 'release_review' ||
    state.phase === 'plan_revision' ||
    // The probes are judged once they have taught the plan, straight from the distill step.
    (state.phase === 'plan_distill' && !probesDistilled(state))
  )
    return undefined;
  const materializedIds = new Set([...state.probeNodeIds, ...(state.massNodeIds ?? [])]);
  const materialized = graph.nodes.filter((node) => materializedIds.has(node.id));
  if (materialized.some((node) => !TERMINAL_NODE_STATUSES.has(node.status))) return undefined;
  return evaluateRolloutGate({ graph, policy, state });
};

/** Whether a node is one of the current batch's released members (R6 routing). */
export const isBatchMember = (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
): boolean => {
  const state = graph.goal.config?.rolloutState;
  if (!state) return false;
  return state.probeNodeIds.includes(nodeId) || (state.massNodeIds ?? []).includes(nodeId);
};

/**
 * Hand a blocked batch gate to a person.
 *
 * The batch cannot advance on its own, so this opens a decision on the Assay
 * and pauses the goal with the pattern-break reason. The choice is the v3
 * fork: revise the same recipe (repeat the v1 → v2 loop) or fork a fresh
 * recipe for the units that broke, inside this batch — never a silent park.
 */
export const openPatternBreakGate = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  message: string,
  effects: GoalAdvanceEffect[],
  /** What held the batch: the gate's own verdict, or one unit's failed check (R6). */
  cause: { gate?: RolloutGateResult; unitId?: string } = {},
): Promise<GoalTickResult> => {
  const goalId = graph.goal.id;
  const state = graph.goal.config?.rolloutState;
  if (!state) return { goalId, message, outcome: 'waiting_human' };

  const reason = `${PATTERN_BREAK_PAUSE_REASON}: ${message}`;
  // Overlapping advances can both see the batch break. Claim it under the
  // goal row's lock: the first opens the gate — materializing the Assay a
  // `full` rollout never created — and records it in the same transaction;
  // the rest find the break already open and reuse its gate instead of
  // opening a second assay and decision that would re-park the goal later.
  const claim = await ctx.db.transaction(async (tx) => {
    const goalModel = new GoalRepository(tx, ctx.userId, ctx.workspaceId);
    const locked = await goalModel.lockById(goalId);
    const current = locked?.config?.rolloutState;
    if (!locked || !current) return undefined;
    if (current.phase === 'pattern_break')
      return { gateNodeId: current.assayNodeId, opened: false as const };
    const writer = new GoalGraphModel(tx, ctx.userId, ctx.workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });

    // The gate hangs on the Assay. A `full` rollout never created one — it
    // skips the probe gate — but a break still needs a `decision` node for the
    // human question and, later, for the restart (a `batch` node cannot carry
    // a decision), so the gate target is stable whichever trigger opened it.
    let gateNodeId = current.assayNodeId;
    if (!gateNodeId) {
      const assay = await writer.createNode(goalId, {
        description:
          'Whether this repeated batch can be delivered without further human decisions.',
        kind: 'decision',
        scopeId: current.batchNodeId,
        status: 'proposed',
        title: GOAL_BATCH_ASSAY_TITLE,
      });
      if (!assay) return undefined;
      gateNodeId = assay.id;
    }
    // The ids are the stable vocabulary; the human-facing labels and their
    // consequences live in the locale files and are resolved by option id on
    // the client (like the retry/retire/fail gates), so no English copy is
    // persisted into a gate a non-English reader has to answer.
    const decision = await writer.createDecision(goalId, gateNodeId, {
      authority: 'user',
      options: [
        {
          id: GOAL_BATCH_BREAK_OPTION.revise,
          label: 'Revise the recipe and re-probe',
        },
        {
          // One batch carries one roster and one gate, so this is not a second
          // batch running in parallel: it forks the recipe (no `revises`
          // chain) for the units that broke, inside this same batch.
          id: GOAL_BATCH_BREAK_OPTION.newClass,
          label: 'Fork a fresh recipe',
        },
      ],
      question: `${message}\n\n${GOAL_BATCH_BREAK_QUESTION_TAIL}`,
      requestedUserId: ctx.userId,
    });
    await writer.updateNodeStatus(goalId, gateNodeId, 'waiting', reason);
    await goalModel.updateRolloutState(
      goalId,
      withGateVerdict(
        { ...current, assayNodeId: gateNodeId, phase: 'pattern_break' },
        {
          checks: cause.gate?.checks ?? [],
          message,
          nodeId: cause.unitId,
          outcome: 'blocked',
          revision: current.templateRevision,
          trigger: cause.unitId ? 'unit' : 'gate',
          waveIndex: current.waveIndex,
        },
      ),
    );
    // Park the goal in the same commit, from the locked row: once the gate is
    // visible an answer may land at any moment, and a pause written after it
    // from an older snapshot would re-park a goal the answer just resumed.
    await goalModel.updatePauseReason(goalId, 'pattern_break');
    if (locked.status !== 'paused' && !GOAL_ENDED_STATUSES.has(locked.status)) {
      await goalModel.updateStatus(goalId, 'paused');
      await writer
        .recordGoalStatus(goalId, locked.status, 'paused', reason)
        .catch((error) => console.error('[GoalService] failed to record goal status:', error));
    }
    return { decisionId: decision?.id, gateNodeId, opened: true as const };
  });
  if (!claim) return { goalId, message, outcome: 'waiting_human' };
  // Another advance opened this break; it parks the goal.
  if (!claim.opened) return { goalId, message, nodeId: claim.gateNodeId, outcome: 'waiting_human' };
  const gateNodeId = claim.gateNodeId;
  effects.push({
    detail: message,
    nodeId: gateNodeId,
    targetId: claim.decisionId ?? gateNodeId,
    type: 'opened_decision',
  });
  // Home lists what waits on the person from its briefs, so the gate stays
  // findable after it is dismissed from the approval island. It offers no
  // one-click answers: revising needs a correction, written on the goal page.
  if (claim.decisionId)
    await ctx.briefs.openDecision(graph.goal, {
      decisionId: claim.decisionId,
      options: [],
      question: `${message}\n\n${GOAL_BATCH_BREAK_QUESTION_TAIL}`,
    });
  effects.push({ type: 'goal_status', detail: 'paused: pattern_break' });
  return { goalId, message, nodeId: gateNodeId, outcome: 'waiting_human' };
};

/**
 * R5: restart the canary loop after a person intervened on a batch gate.
 *
 * The person's answer is the single human judgment; the coordinator opens the
 * next recipe round from it. `revise` chains a new Template onto the old one
 * (`revises`); `new_class` forks a fresh Template with no chain edge, still
 * inside this batch. Either way the members that broke are retired and
 * re-opened as the new canary, and the rollout returns to the probe phase, so
 * the class is proved again instead of rerun by hand.
 *
 * The correction is the *new recipe*: it is folded into the policy and written
 * on the Template, so the re-opened probes and every later wave are briefed
 * from the revised transformation — not from the outline that just failed.
 */
export const restartRolloutLoop = async (
  ctx: GoalServiceContext,
  goalId: string,
  decisionId: string,
  optionId: string,
  resolution: string | undefined,
) => {
  const graph = await ctx.requireGraph(goalId);
  const policy = graph.goal.config?.rollout;
  const state = graph.goal.config?.rolloutState;
  if (!policy || !state)
    return ctx.graphModel.resolveDecision(goalId, decisionId, optionId, resolution);

  const batchId = state.batchNodeId;
  const roster = state.unitTitles ?? [];
  const released = state.releasedCount ?? state.probeNodeIds.length;
  // The correction the person wrote. A revision carries the plan forward and
  // appends it as its own section, so each version reads whole and diffs
  // against the last one; a fork starts again from the original outline. The
  // result is the new recipe: later waves only ever read
  // `policy.spec.recipeOutline`, so a note kept solely on the Template would
  // never reach the tasks meant to test it.
  const baseOutline = policy.spec?.recipeOutline?.trim() ?? '';
  const correction = (resolution ?? '').trim();
  const revision = state.templateRevision + 1;
  const previousPlan = state.templateNodeId
    ? graph.nodes.find((node) => node.id === state.templateNodeId)?.description?.trim()
    : undefined;
  // A fork starts from the batch's original outline — kept on the batch node,
  // since every revision rewrites the policy's — not from the revised plan.
  const originalOutline =
    graph.nodes.find((node) => node.id === batchId)?.description?.trim() || baseOutline;
  const basePlan = optionId === 'new_class' ? originalOutline : previousPlan || baseOutline;
  const revisedOutline = [basePlan, correction && `### v${revision}\n${correction}`]
    .filter(Boolean)
    .join('\n\n');

  // The answer and the round it opens land together. Every write below —
  // resolving the question included — commits in one transaction under the
  // goal row's lock, so a failure part-way leaves the question open to answer
  // again rather than consumed beside half a round; and a second answer
  // racing this one finds the break already restarted.
  // What a break teaches is mounted on the agent that runs the batch's units
  // (a run's expertise snapshot reads the executing agent's domains, not the
  // project's) — resolved like the task assignee, so a deleted executor falls
  // back to the goal agent rather than a binding that cannot be written. Read
  // before the transaction, which holds the goal row.
  const carrierAgentId = await ctx.resolveTaskAssignee(graph.goal);
  const carrier: ExpertiseCarrier = carrierAgentId
    ? { id: carrierAgentId, type: 'agent' }
    : { type: 'user' };

  const committed = await ctx.db.transaction(async (tx) => {
    const goalModel = new GoalRepository(tx, ctx.userId, ctx.workspaceId);
    const current = (await goalModel.lockById(goalId))?.config?.rolloutState;
    if (current?.phase !== 'pattern_break') return undefined;
    const resolved = await new GoalGraphModel(tx, ctx.userId, ctx.workspaceId).resolveDecision(
      goalId,
      decisionId,
      optionId,
      resolution,
    );
    if (!resolved) return undefined;
    const writer = new GoalGraphModel(tx, ctx.userId, ctx.workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });

    // 1. A new recipe revision, or a forked new class (no `revises` chain).
    const template = await writer.createNode(goalId, {
      description: revisedOutline || baseOutline,
      kind: 'finding',
      scopeId: batchId,
      title: GOAL_BATCH_TEMPLATE_TITLE,
    });
    if (template && optionId !== 'new_class' && state.templateNodeId) {
      await writer.createEdge(goalId, template.id, state.templateNodeId, 'revises');
    }

    // The plan skill takes the revision as its next version, and the break
    // teaches the batch: a rule the executor reads, compiled into a criterion
    // the verifier judges every later unit by. A fork starts a new class of
    // units — its correction describes them, it is not a rule for the old
    // ones. Each runs in its own savepoint: a failure there costs the skill
    // version or the lesson, never the round the answer opens.
    const inSavepoint = <T>(label: string, run: (db: typeof tx) => Promise<T>) =>
      tx.transaction(run).catch((error) => {
        log('restartRolloutLoop: %s failed: %O', label, error);
        return undefined;
      });
    let planSkill = state.planSkill;
    let planVersion: number | undefined;
    if (planSkill && revisedOutline) {
      const skill = planSkill;
      const version = await inSavepoint('plan skill revision', (db) =>
        new BatchPlanSkillService(db, ctx.userId, ctx.workspaceId).revise(skill, {
          goalId,
          guidance: correction || undefined,
          plan: revisedOutline,
          revision,
        }),
      );
      // The revision did not land (the skill was deleted, or the write
      // failed): units must not load a skill that lacks it. They fall back to
      // copying the revised plan, and the batch drops the stale reference.
      if (version === undefined) planSkill = undefined;
      else planVersion = version;
    } else if (!planSkill && revisedOutline) {
      // A batch from before plans were skills moves into one now, carrying
      // every earlier version of its plan.
      const inBatch = new Set(
        graph.edges
          .filter((edge) => edge.kind === 'contains' && edge.sourceNodeId === batchId)
          .map((edge) => edge.targetNodeId),
      );
      const earlier = graph.nodes
        .filter(
          (node) =>
            node.kind === 'finding' &&
            node.title === GOAL_BATCH_TEMPLATE_TITLE &&
            inBatch.has(node.id),
        )
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((node) => node.description?.trim() ?? '');
      planSkill = await inSavepoint('plan skill adoption', (db) =>
        new BatchPlanSkillService(db, ctx.userId, ctx.workspaceId).adopt({
          batchNodeId: batchId,
          goalId,
          goalTitle: graph.goal.title,
          versions: [...earlier, revisedOutline],
        }),
      );
    }
    // A fork starts a new class: the old class's rules must stop reaching
    // runs too, not only its acceptance — retire them in the shared domain,
    // where the executor's expertise would otherwise keep injecting them.
    // Not in a forgiving savepoint: the fork clears the batch's record of
    // them below, so a failure here fails the fork (the question stays open
    // to answer again) rather than leaving them active and forgotten.
    if (optionId === 'new_class' && state.learnings?.length) {
      const expertise = new ExpertiseModel(tx, ctx.userId, ctx.workspaceId);
      for (const learning of state.learnings) await expertise.retireLesson(learning.lessonId);
    }
    const learned =
      correction && optionId !== 'new_class'
        ? await inSavepoint('break learning', (db) =>
            new BatchPlanSkillService(db, ctx.userId, ctx.workspaceId).learn({
              carrier,
              domainId: state.learningDomainId,
              // What the gate found: this round's latest hold, in its own words.
              found:
                state.gateLog?.findLast(
                  (entry) =>
                    entry.outcome === 'blocked' && entry.revision === state.templateRevision,
                )?.message ?? 'the release gate held',
              goalTitle: graph.goal.title,
              guidance: correction,
              planSkill,
              revision: state.templateRevision,
            }),
          )
        : undefined;

    // 2. Retire the members that broke or were superseded, never delete them —
    // the new round is `derived_from` them (decision #4). A member an earlier
    // round already re-opened is history, not a unit to re-open again.
    const memberIds = new Set([...state.probeNodeIds, ...(state.massNodeIds ?? [])]);
    const reopenedIds = new Set(
      graph.edges.filter((edge) => edge.kind === 'derived_from').map((edge) => edge.targetNodeId),
    );
    const broken: { brief?: string; id: string; title: string }[] = [];
    for (const node of graph.nodes) {
      if (!memberIds.has(node.id) || node.status === 'resolved' || reopenedIds.has(node.id))
        continue;
      broken.push({ brief: carriedUnitBrief(node), id: node.id, title: node.title });
      if (!TERMINAL_NODE_STATUSES.has(node.status)) {
        await writer.updateNodeStatus(
          goalId,
          node.id,
          'retired',
          'superseded by a new recipe revision',
        );
      }
    }

    // 3. A fresh gate for the fresh round.
    const assay = await writer.createNode(goalId, {
      description: 'Whether this repeated batch can be delivered without further human decisions.',
      kind: 'decision',
      scopeId: batchId,
      status: 'proposed',
      title: GOAL_BATCH_ASSAY_TITLE,
    });
    if (!assay) throw new Error('Failed to create the next batch gate');

    // The revised recipe becomes the batch's policy, so the probes below and
    // every later wave (which read it off the graph) carry the correction.
    await goalModel.updateRolloutPolicy(goalId, {
      ...policy,
      spec: {
        ...policy.spec,
        recipeOutline: revisedOutline || baseOutline,
        repeatable: policy.spec?.repeatable ?? true,
      },
    });

    // 4. The new canary re-opens the units that broke, as new tasks that
    // supersede the retired ones (decision #4: new task + retire, never move).
    // Cap it at the canary size: a break in a large wave — or a `full` rollout
    // that released the whole class — must not redispatch every member at once.
    // The broken units beyond the canary stay owed, and the waves after the gate
    // re-deliver them under the revised recipe. Only a gate that blocked with
    // every member resolved has nothing to re-open; it re-probes the next slice.
    const canarySize = Math.max(
      2,
      Math.min(policy.canarySize ?? ROLLOUT_CANARY_SIZE_DEFAULT, ROLLOUT_MAX_CANARY_SIZE),
    );
    const reOpen = broken.slice(0, canarySize);
    const deferred = broken.slice(canarySize).map((unit) => unit.title);
    const fresh = broken.length ? [] : roster.slice(released, released + canarySize);
    // Nothing broke and nothing is left to release — the gate held on something
    // else, such as an untested axis. Re-probe units this round delivered,
    // under the revision, so the new canary is never empty (an empty one would
    // re-open the same break at once).
    const reProbe =
      broken.length || fresh.length
        ? []
        : [...memberIds]
            .map((id) => graph.nodes.find((node) => node.id === id))
            .filter(
              (node): node is NonNullable<typeof node> =>
                !!node && node.status === 'resolved' && !reopenedIds.has(node.id),
            )
            .slice(0, canarySize)
            .map((node) => ({ brief: carriedUnitBrief(node), id: node.id, title: node.title }));
    const units = [
      ...[...reOpen, ...reProbe].map((unit) => ({
        brief: unit.brief,
        from: unit.id,
        title: unit.title,
      })),
      ...fresh.map((title) => ({
        brief: policy.unitBriefs?.[title],
        from: undefined as string | undefined,
        title,
      })),
    ];
    const probeIds: string[] = [];
    const opened: { from: string | undefined; title: string }[] = [];
    for (const unit of units) {
      const nodeId = await createRecipeUnitTask(
        writer,
        goalId,
        batchId,
        unit.title,
        { outline: revisedOutline || baseOutline, skill: planSkill },
        unit.brief,
      );
      if (!nodeId) continue;
      probeIds.push(nodeId);
      opened.push(unit);
      if (unit.from) {
        await writer.createEdge(goalId, nodeId, unit.from, 'derived_from').catch(() => {});
      }
    }
    for (const probeId of probeIds) {
      await writer.createEdge(goalId, assay.id, probeId, 'depends_on');
    }

    // 5. Back to canary, on the new revision. The roster is re-cut to what is
    // still owed — the new probes first, then the broken units not re-probed,
    // then whatever was never released — so the waves deliver only the
    // remainder and units already delivered under the old recipe drop out.
    const remaining = Array.from(
      new Set([
        ...opened.map((unit) => unit.title),
        ...deferred,
        ...roster.slice(released + fresh.length),
      ]),
    );
    await goalModel.updateRolloutState(goalId, {
      ...state,
      assayNodeId: assay.id,
      // A round's plan can be rewritten in place, so its skill version is kept, not derived.
      planVersions: planVersion
        ? { ...state.planVersions, [String(revision)]: planVersion }
        : state.planVersions,
      // The new canary is a fresh round: the old waves' members — the broken
      // ones now retired — must not count against its gate.
      massNodeIds: undefined,
      phase: 'probe',
      probeNodeIds: probeIds,
      releasedCount: opened.length,
      // A fork starts a new class of units: the old class's rules do not
      // bind it, so its learnings start empty.
      learningDomainId:
        optionId === 'new_class' ? undefined : (learned?.domainId ?? state.learningDomainId),
      learnings:
        optionId === 'new_class'
          ? undefined
          : learned
            ? [...(state.learnings ?? []), learned.learning]
            : state.learnings,
      planSkill,
      templateNodeId: template?.id ?? state.templateNodeId,
      templateRevision: state.templateRevision + 1,
      unitTitles: remaining,
      waveIndex: 0,
    });
    return { brokenIds: broken.map((unit) => unit.id), resolved };
  });
  if (!committed) return undefined;

  // A sibling still running when the gate was answered would keep spending —
  // and could deliver — beside the probe that replaces it. Its node is fenced
  // as retired above; stop the Task behind it. Not part of the transaction:
  // stopping a run cannot be rolled back, and retrying it is harmless.
  if (committed.brokenIds.length) await ctx.stopFencedTasks(goalId, new Set(committed.brokenIds));
  await ctx.setPauseReason(goalId, undefined);
  return committed.resolved;
};
