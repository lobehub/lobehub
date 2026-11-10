import { randomUUID } from 'node:crypto';

import type { GoalAdvanceEffect } from '@lobechat/agent-tracing';
import {
  GOAL_CLARIFICATION_TITLE,
  GOAL_COORDINATOR_ACTOR_ID,
  ROLLOUT_CANARY_SIZE_DEFAULT,
  ROLLOUT_MAX_CANARY_SIZE,
} from '@lobechat/const/goal';
import type { GoalGraphSnapshot, GoalRolloutPolicy } from '@lobechat/types';

import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';

import { GoalCriteriaGeneratorService, type GoalDecompositionDraft } from '../criteriaGenerator';
import { GoalManagerService } from '../manager';
import {
  materializeRolloutBatch,
  MAX_ROLLOUT_ROSTER,
  normalizeRolloutRoster,
} from '../rolloutBatch';
import { evaluateHomogeneity } from '../spec';
import {
  clarificationOptions,
  collectClarificationAnswers,
  hasAskedClarification,
  normalizeUnderstanding,
  UNDERSTANDING_CONFIDENCE,
} from '../understanding';
import type { GoalServiceContext } from './types';
import { log } from './utils';

/**
 * Why the system planner's one pass should go to the main Agent, or undefined
 * when its plan can run: the pass failed, the planner said it was not enough,
 * or it claimed a batch it could not lay out. A goal that is simply not a batch
 * is not a reason — the ordinary plan is right for it.
 */
const planningHandoffReason = (
  plan: GoalDecompositionDraft | undefined,
  plannerFailure: string | undefined,
  rollout: GoalRolloutPolicy | undefined,
  maxUnits: number,
): string | undefined => {
  if (!plan) return `Planner failed (${plannerFailure ?? 'no answer'})`;
  const asked = plan.escalate?.trim();
  if (asked) return `Planner asked for the main Agent: ${asked}`;
  if (!plan.rollout || rollout?.trigger === 'off') return undefined;
  const verdict = evaluateHomogeneity(
    plan.rollout,
    plan.tasks.map((draft) => ({ instruction: draft.instruction, title: draft.title })),
    { maxUnits, minUnits: rollout?.minHomogeneousUnits },
  );
  return verdict.malformed
    ? `Batch claim could not be laid out (${verdict.reasons.join('; ')})`
    : undefined;
};

/**
 * One line for why the planner failed, for the audit trail. Model runtime
 * errors arrive as plain objects (`{ errorType, error }`), not `Error`s.
 */
const describePlannerFailure = (error: unknown): string => {
  const runtime = error as { error?: { message?: string }; errorType?: string } | undefined;
  const text =
    error instanceof Error
      ? error.message
      : [runtime?.errorType, runtime?.error?.message].filter(Boolean).join(': ') || String(error);
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
};

/**
 * Turn a goal with no tasks into an explorable structure: the LLM plans the
 * core question plus 1–5 independent directions, each carrying only its own
 * deliverable requirements. A planning failure degrades to one task seeded
 * from the raw requirement — the goal must never stall on its planner.
 */
export const planDecomposition = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  effects: GoalAdvanceEffect[],
) => {
  const goalId = graph.goal.id;
  const problem = graph.nodes.find((node) => node.kind === 'problem');
  const requirement = graph.goal.requirement ?? problem?.description ?? graph.goal.title;

  const claim = await ctx.goalModel.claimPlanning(goalId);
  if (!claim)
    return {
      goalId,
      message: 'Another advance is already planning this goal or tasks already exist',
      outcome: 'waiting_external' as const,
    };
  try {
    if (claim.previousStatus === 'planning') {
      await ctx.coordinatorGraph
        .recordGoalStatus(goalId, 'planning', 'running', 'decomposition claimed')
        .catch((error) => console.error('[GoalService] failed to record goal status:', error));
    }

    const generator = new GoalCriteriaGeneratorService(ctx.db, ctx.userId, ctx.workspaceId);
    const clarifications = collectClarificationAnswers(graph);
    // A failed plan still starts the goal from the raw requirement, but says
    // so: the server log and the first task's audit event carry the cause.
    let plannerFailure: string | undefined;
    const plan = await generator
      .decompose({ clarifications, goalConfig: graph.goal.config, requirement })
      .catch((error: unknown) => {
        plannerFailure = describePlannerFailure(error);
        console.error(
          `[GoalService] goal ${goalId} decomposition failed; starting from the raw requirement:`,
          error,
        );
        return undefined;
      });
    // A graph without a problem node has nowhere to hang a question, so its
    // questions are planned around as assumptions like a re-plan's would be.
    const understanding = plan
      ? normalizeUnderstanding(
          plan,
          hasAskedClarification(graph) || !problem,
          clarifications.map((item) => item.question),
        )
      : undefined;

    // The system planner does one simple pass. When that pass failed, said it
    // was not enough, or claimed a batch it could not lay out, the main Agent
    // — which can inspect the workspace — plans the goal instead. Without one
    // (no goal agent, or no turn could start) the pass below still runs.
    const handoff = planningHandoffReason(
      plan,
      plannerFailure,
      graph.goal.config?.rollout,
      MAX_ROLLOUT_ROSTER,
    );
    if (handoff && graph.goal.agentId) {
      const handed = await ctx.handPlanningToMainAgent(graph, handoff);
      if (handed) {
        effects.push({
          detail: `planning handed to the main Agent: ${handoff}`,
          type: 'goal_status',
        });
        return handed;
      }
    }

    const draftTasks: GoalDecompositionDraft['tasks'] = plan?.tasks ?? [
      {
        // The user's answers are authoritative; a planner failure after the
        // clarification round must not start the work without them.
        instruction: [
          // After a clarification round, scope the work by the original request
          // plus the answers — never by a summary a planner wrote earlier.
          clarifications.length > 0 ? requirement : (problem?.description ?? requirement),
          clarifications.length > 0
            ? `Answered clarifications (authoritative):\n${clarifications
                .map((item) => `- Q: ${item.question}\n  A: ${item.answer}`)
                .join('\n')}`
            : undefined,
        ]
          .filter(Boolean)
          .join('\n\n'),
        title: graph.goal.title,
      },
    ];

    const askedDecisions: { id: string; question: string }[] = [];
    // Only the current lease owner may commit. The model call above does not
    // hold a database lock; all graph changes below share one short transaction.
    const committed = await ctx.db.transaction(async (tx) => {
      const goalModel = new GoalModel(tx, ctx.userId, ctx.workspaceId);
      const current = await goalModel.findByIdForUpdate(goalId);
      const checkpoint = current?.config?.planningCheckpoint;
      if (
        !current ||
        current.status !== 'running' ||
        checkpoint?.token !== claim.token ||
        Date.parse(checkpoint.expiresAt) <= Date.now()
      )
        return undefined;
      const writer = new GoalGraphModel(tx, ctx.userId, ctx.workspaceId, {
        id: GOAL_COORDINATOR_ACTOR_ID,
        type: 'system',
      });
      const fresh = await writer.getGraph(goalId);
      if (!fresh || fresh.nodes.some((node) => node.kind === 'task')) return undefined;
      const currentProblem = fresh.nodes.find((node) => node.kind === 'problem');
      if (
        // Not the title: it is a label, so renaming a goal mid-plan keeps the plan.
        fresh.goal.requirement !== graph.goal.requirement ||
        currentProblem?.description !== problem?.description
      )
        return undefined;
      const committedEffects: GoalAdvanceEffect[] = [];

      const asking = Boolean(understanding?.ask.length && currentProblem);
      if (plan && currentProblem) {
        // The node's description becomes the planner's own words for the core
        // question — not the acceptance boilerplate the goal row keeps. A plan
        // that stops to ask commits no tasks, so it keeps the user's own words:
        // the re-plan, or its fallback, must still read the original request.
        await writer.updateNodeDescription(
          goalId,
          currentProblem.id,
          asking ? (currentProblem.description ?? plan.problemStatement) : plan.problemStatement,
          understanding && UNDERSTANDING_CONFIDENCE[understanding.level],
        );
      }
      if (understanding) {
        await goalModel.updateUnderstanding(goalId, {
          assumptions: understanding.assumptions,
          level: understanding.level,
          updatedAt: new Date().toISOString(),
        });
      }

      // A question only the user can answer is asked before anything runs:
      // Tasks planned on a wrong reading of the goal are the most expensive
      // way to find out. No Task is created, so the next plan — made with the
      // answers — starts from the same empty graph.
      if (asking && understanding && currentProblem) {
        for (const question of understanding.ask) {
          const node = await writer.createNode(goalId, {
            description: question.impact,
            kind: 'decision',
            status: 'waiting',
            title: GOAL_CLARIFICATION_TITLE,
          });
          if (!node) throw new Error('Failed to open a clarification decision');
          await writer.createEdge(goalId, currentProblem.id, node.id, 'leads_to');
          const decision = await writer.createDecision(goalId, node.id, {
            authority: 'user',
            options: clarificationOptions(question),
            question: question.question,
            requestedUserId: ctx.userId,
          });
          if (decision) askedDecisions.push({ id: decision.id, question: question.question });
          committedEffects.push({
            detail: question.question,
            nodeId: currentProblem.id,
            targetId: node.id,
            type: 'opened_decision',
          });
        }
        return committedEffects;
      }

      // Batch roll-out: when the planner judges this goal to be one repeated
      // mould — and `spec.ts` agrees — decompose it as a class rather than as
      // N flat siblings. The graph gets one `batch` container, one Template,
      // one Assay and only the K fully-briefed probe tasks; the roster waits in
      // `rolloutState` and the coordinator releases it one wave at a time.
      const rolloutClaim = plan?.rollout ?? null;
      const existingRollout = current.config?.rollout;
      const rolloutTrigger = existingRollout?.trigger ?? 'canary';
      const rolloutEnabled = rolloutTrigger !== 'off';
      const verdict =
        rolloutClaim && rolloutEnabled
          ? evaluateHomogeneity(
              rolloutClaim,
              draftTasks.map((draft) => ({ instruction: draft.instruction, title: draft.title })),
              {
                maxUnits: MAX_ROLLOUT_ROSTER,
                minUnits: existingRollout?.minHomogeneousUnits,
              },
            )
          : { batch: false, malformed: false, reasons: [] as string[] };

      log(
        'decomposition rollout: trigger=%s claim=%o tasks=%d verdict=%o',
        rolloutTrigger,
        rolloutClaim,
        draftTasks.length,
        verdict,
      );

      if (rolloutClaim && rolloutEnabled && verdict.batch && currentProblem) {
        const roster = normalizeRolloutRoster(
          rolloutClaim.units,
          draftTasks,
          draftTasks.length,
          undefined,
          { matchUnitInProbeTitle: true },
        );
        const canarySize =
          rolloutTrigger === 'full'
            ? roster.length
            : Math.max(
                2,
                Math.min(
                  existingRollout?.canarySize ?? ROLLOUT_CANARY_SIZE_DEFAULT,
                  ROLLOUT_MAX_CANARY_SIZE,
                  draftTasks.length,
                ),
              );
        const { probeDrafts, probeIds } = await materializeRolloutBatch({
          canarySize,
          goalId,
          goalModel,
          planSkillOwner: {
            db: tx,
            goalTitle: graph.goal.title,
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
          },
          policy: existingRollout,
          problemId: currentProblem.id,
          probes: draftTasks,
          recipeOutline: rolloutClaim.recipeOutline,
          repeatable: rolloutClaim.repeatable,
          roster,
          trigger: rolloutTrigger === 'full' ? 'full' : 'canary',
          variants: rolloutClaim.variants,
          writer,
        });
        for (const [index, draft] of probeDrafts.entries()) {
          committedEffects.push({
            nodeId: probeIds[index],
            type: 'created_node',
            detail: draft.title,
          });
        }
        return committedEffects;
      }

      // A rollout claim we did NOT turn into a batch — the caller forced
      // `--rollout off`, or the homogeneity check refused it — still carries
      // only the 3–5 representative probes in `tasks`, with the complete
      // roster in `units`. A plain decomposition of `draftTasks` alone would
      // silently drop every other unit, so materialize the whole roster as
      // ordinary tasks instead: the probes keep their first-hand briefs, the
      // rest run from the recipe. The batch config's roster cap does NOT apply
      // here — trimming the fallback would leave the tail of the requested
      // goal undelivered. A goal with no claim at all is unchanged.
      const plannedUnits = rolloutClaim
        ? normalizeRolloutRoster(
            rolloutClaim.units,
            draftTasks,
            draftTasks.length,
            Number.POSITIVE_INFINITY,
            { matchUnitInProbeTitle: true },
          ).map((title, index) => {
            const draft = draftTasks[index];
            return {
              dependsOn: draft?.dependsOn ?? [],
              hypothesis: draft?.hypothesis,
              instruction:
                draft?.instruction ??
                [rolloutClaim.recipeOutline, `Unit: ${title}`].filter(Boolean).join('\n\n'),
              title: draft?.title ?? title,
            };
          })
        : draftTasks;

      // Why this goal was planned unit by unit, on the first task's `created`
      // event: a planner failure, or a batch claim the checks refused.
      // A hand-over that did not happen (no main Agent could take the goal)
      // says so too.
      const unhanded = handoff ? '; no main Agent could take the goal' : '';
      let fallbackReason = !plan
        ? `Planner failed (${plannerFailure ?? 'no answer'})${unhanded}; started from the raw requirement`
        : plan.escalate?.trim()
          ? `Planner asked for the main Agent (${plan.escalate.trim()})${unhanded}; ran its own plan`
          : rolloutClaim && rolloutEnabled && !verdict.batch
            ? `Batch claim refused (${verdict.reasons.join('; ')}); planned unit by unit`
            : undefined;

      const createdIds: string[] = [];
      for (const draft of plannedUnits) {
        // An experiment is a container for a candidate answer, not the
        // default shell around every planned step. Only a direction the
        // planner marked with a hypothesis gets one; a certain delivery step
        // attaches straight to the problem, the same shape a manager-planned
        // Task takes.
        const hypothesis = draft.hypothesis?.trim();
        const experiment =
          currentProblem && hypothesis
            ? await writer.createNode(goalId, {
                kind: 'experiment',
                title: draft.title,
                description: hypothesis,
                questionId: currentProblem.id,
              })
            : undefined;
        if (currentProblem && hypothesis && !experiment)
          throw new Error('Failed to create a planned experiment');
        const node = await writer.createNode(goalId, {
          scopeId: experiment?.id,
          description: draft.instruction,
          kind: 'task',
          reason: fallbackReason,
          title: draft.title,
        });
        if (!node) throw new Error('Failed to create a planned task');
        if (!experiment && currentProblem)
          await writer.createEdge(goalId, currentProblem.id, node.id, 'decomposes');
        createdIds.push(node.id);
        committedEffects.push({ nodeId: node.id, type: 'created_node', detail: draft.title });
        fallbackReason = undefined;
      }

      // The planner's `dependsOn` indices become `depends_on` edges, drawn
      // dependent → prerequisite the way `decideNextMove` reads a blocker. Only
      // earlier indices are honoured, so a hallucinated forward or self reference
      // can never form a cycle that deadlocks the frontier.
      for (const [index, draft] of plannedUnits.entries()) {
        const nodeId = createdIds[index];
        if (!nodeId) continue;
        for (const dep of new Set(draft.dependsOn ?? [])) {
          const prerequisiteId = dep < index ? createdIds[dep] : undefined;
          if (!prerequisiteId) continue;
          await writer.createEdge(goalId, nodeId, prerequisiteId, 'depends_on');
        }
      }
      return committedEffects;
    });
    if (!committed) {
      return {
        goalId,
        message: 'Planning lease or input changed; re-read the graph',
        outcome: 'advanced' as const,
      };
    }
    effects.push(...committed);

    const asked = committed.filter((effect) => effect.type === 'opened_decision').length;
    if (asked > 0) {
      await ctx.briefs.openClarification(
        graph.goal,
        askedDecisions.map((decision) => decision.id),
        askedDecisions.map((decision) => decision.question),
      );
      return {
        goalId,
        message: `Asked ${asked} clarification question${asked > 1 ? 's' : ''} before planning`,
        outcome: 'advanced' as const,
      };
    }

    return {
      goalId,
      message: plan
        ? `Planned ${draftTasks.length} exploration direction${draftTasks.length > 1 ? 's' : ''}`
        : 'Planner unavailable; seeded a single task from the requirement',
      outcome: 'advanced' as const,
    };
  } finally {
    await ctx.goalModel.releasePlanning(goalId, claim.token);
  }
};

/**
 * Give the goal's planning to its main Agent, opening one for a goal that had
 * none. Returns undefined when no turn could start (no eligible agent, turn or
 * budget limits); a policy opened here is then removed again — only that one,
 * by its token — so the goal keeps the system planner and does not gain an
 * uninvited planner later, while a policy a person set meanwhile stays.
 */
export const handPlanningToMainAgent = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  reason: string,
) => {
  const goalId = graph.goal.id;
  const token = randomUUID();
  await ctx.goalModel.openManagerPolicy(goalId, { openedForHandoff: token });
  const result = await new GoalManagerService(ctx.db, ctx.userId, ctx.workspaceId)
    .planInstead(await ctx.requireGraph(goalId), reason)
    .catch((error: unknown) => {
      console.error(`[GoalService] goal ${goalId} could not hand planning over:`, error);
      return null;
    });
  if (result) return result;
  await ctx.goalModel.closeHandoffManagerPolicy(goalId, token);
  return undefined;
};
