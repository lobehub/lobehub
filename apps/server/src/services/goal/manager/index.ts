import { GOAL_ACCEPTANCE_TASK_TITLE, GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';
import { buildGoalManagerPrompt } from '@lobechat/prompts';
import type {
  GoalGraphSnapshot,
  GoalItem,
  GoalManagerState,
  GoalPlanContext,
  GoalTickResult,
  TaskItem,
} from '@lobechat/types';
import { isAgentOperationInFlight } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { TopicTrigger } from '@/const/topic';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { GoalRepository } from '@/database/repositories/goal';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { readDeviceDispatchRoute } from '@/server/services/aiAgent/helpers/heteroErrors';
import { TopicStartReservationError } from '@/server/services/aiAgent/topicStartReservation';
import { deviceGateway } from '@/server/services/deviceGateway';

import { goalModelOverride } from '../modelConfig';
import { countUnchargedRuns, DEFAULT_MANAGER_MAX_TURNS } from '../recoveryPolicy';
import { scheduleGoalAdvance } from '../scheduler';
import { recoveryEligibility } from '../supervisor/policy';
import { GoalWaitService } from '../wait';
import { assertOperationOwnsTurn, planAdmission } from './admission';
import {
  adoptConversationTurn,
  bindTopic,
  closeTurnOnStart,
  moveConversationTo,
} from './conversation';
import { decideFailedTurn } from './failedTurn';
import { budgetBlocked, managerUsage, reviewFeedback } from './planningInputs';
import type { GoalPlan } from './planSchema';
import { submitPlan } from './submit';
import {
  activeStatuses,
  answeredProblem,
  type GoalTakeoverProblem,
  type ManagerContext,
  managerSnapshot,
  managerTurnToken,
  problemKey,
  saveManagerState,
  terminalNodes,
  turnOperation,
} from './turnState';

export { decideFailedTurn, type FailedTurnDecision, MAX_FAILED_MANAGER_TURNS } from './failedTurn';
export { goalPlanSchema } from './planSchema';
export {
  answeredProblem,
  type GoalTakeoverProblem,
  managerSnapshot,
  problemKey,
} from './turnState';

const TIMEOUT_MS = 20 * 60_000;
/** Task comments listed in one planning turn's message; older ones are counted, not shown. */
const FEEDBACK_NOTE_LIMIT = 20;

/** Durable wakeups around ordinary CLI-capable Agent runs. No supervisor builtin tools. */
export class GoalManagerService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private get ctx(): ManagerContext {
    return { db: this.db, userId: this.userId, workspaceId: this.workspaceId };
  }

  /** Management spend; see `planningInputs.ts`. */
  usage = async (goalId: string, state?: GoalManagerState) => managerUsage(this.ctx, goalId, state);

  /** Receipt moves around the management conversation; see `conversation.ts`. */
  adoptConversationTurn = async (goalId: string, run: { operationId: string; topicId: string }) =>
    adoptConversationTurn(this.ctx, goalId, run);

  closeTurnOnStart = async (goal: GoalItem, hasWork: boolean) =>
    closeTurnOnStart(this.ctx, goal, hasWork);

  moveConversationTo = async (
    goalId: string,
    agentId: string,
  ): Promise<GoalManagerState | undefined> => moveConversationTo(this.ctx, goalId, agentId);

  bindTopic = async (
    goalId: string,
    run: { agentId: string; operationId: string; topicId: string },
    options?: { force?: boolean },
  ) => bindTopic(this.ctx, goalId, run, options);

  private graph = (db = this.db) => new GoalGraphModel(db, this.userId, this.workspaceId);
  private coordinatorGraph = (db = this.db) =>
    new GoalGraphModel(db, this.userId, this.workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });

  private wait = async (goalId: string, message: string): Promise<GoalTickResult> => {
    await scheduleGoalAdvance({
      goalId,
      userId: this.userId,
      workspaceId: this.workspaceId,
      delay: 5,
    });
    return { goalId, outcome: 'waiting_external', message };
  };

  /** Whether the device the last turn could not reach is connected again. */
  private offlineDeviceIsBack = async (state: GoalManagerState) => {
    const route = state.offlineDevice;
    if (!route || !deviceGateway.isConfigured) return false;
    const devices = await deviceGateway.queryDeviceList(route.userId, route.workspaceId);
    return devices.some((device) => device.deviceId === route.deviceId);
  };

  private pause = async (goalId: string, message: string): Promise<GoalTickResult> => {
    await this.db.transaction(async (db) => {
      const model = new GoalRepository(db, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      if (goal && activeStatuses.has(goal.status)) {
        await model.updateStatus(goalId, 'paused');
        // The system paused it (a spent turn budget, an unconfirmed main Agent
        // turn), so the timeline must not file it as the owner's pause.
        await this.coordinatorGraph(db).recordGoalStatus(goalId, goal.status, 'paused', message);
      }
    });
    return { goalId, outcome: 'no_progress', message };
  };

  stop = async (graph: GoalGraphSnapshot) => {
    const state = graph.goal.config?.managerState;
    if (!state || state.consumed) return;
    const operations = new AgentOperationModel(this.db, this.userId, this.workspaceId);
    const op = state.operationId
      ? await operations.findById(state.operationId)
      : await operations.findByTopicSourceMessage(state.topicId, `msg_goal_manager_${state.token}`);
    if (!op)
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'Main Agent dispatch is unconfirmed; retain the Goal until its execution can be reconciled',
      });
    if (!isAgentOperationInFlight(op.status)) return;
    const result = await new AiAgentService(this.db, this.userId, {
      workspaceId: this.workspaceId,
    }).interruptTask({ operationId: op.id, topicId: state.topicId });
    if (!result.success || result.deviceCancellationConfirmed === false)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Main Agent exit was not confirmed; Goal was not deleted',
      });
  };

  /**
   * Advance the goal through its main Agent.
   *
   * `mayStartTurn` is what orders the two planners. The system's own
   * exploration planner owns the ordinary path; a main Agent is the fallback for
   * problems that planner cannot express, so on a Goal that has exploration
   * configured this settles an in-flight turn or resumes an explicit continuation.
   * A Goal whose only planner IS the main Agent keeps starting turns here.
   */
  advance = async (
    graph: GoalGraphSnapshot,
    options?: { mayStartTurn?: boolean },
  ): Promise<GoalTickResult | null> => {
    if (!this.eligible(graph)) return null;
    const settled = await this.settleInFlight(graph);
    if (settled) return settled;
    const waiting = await new GoalWaitService(this.db, this.userId, this.workspaceId).advance(
      graph,
    );
    if (waiting) return waiting;
    const state = graph.goal.config?.managerState;
    if (options?.mayStartTurn === false && !state?.replanReason && !state?.wait?.wake) return null;
    return this.startTurn(graph);
  };

  /**
   * Hand a problem the coordinator could not route to the main Agent, instead of
   * stopping the Goal on a person.
   *
   * The invitation IS the authorization: the caller has already decided it would
   * otherwise open a human gate, so the ordinary "is there unfinished work" and
   * "is this a recognised transport failure" narrowings do not apply — those
   * exist to stop an uninvited turn from preempting running work. Turn limits,
   * budgets and the compare-and-swap claim still hold, and a main Agent that
   * cannot help answers `escalate`, which puts the gate back.
   */
  takeOver = async (
    graph: GoalGraphSnapshot,
    problem: GoalTakeoverProblem,
  ): Promise<GoalTickResult | null> => {
    if (!this.eligible(graph)) return null;
    // Already answered: a takeover turn that ran for THIS problem has had its say,
    // so handing it over again would buy the same plan instead of asking a person.
    // `answeredProblem` is what the caller attaches to the gate.
    if (answeredProblem(graph.goal.config?.managerState)?.key === problemKey(problem)) return null;
    const settled = await this.settleInFlight(graph);
    if (settled) return settled;
    return this.startTurn(graph, problem);
  };

  /**
   * Plan a goal the system planner handed over in its first pass — it failed, or
   * judged one pass not enough. Nothing runs yet, so this is an ordinary first
   * turn; the reason reaches the Agent as the turn's continuation.
   */
  async planInstead(graph: GoalGraphSnapshot, reason: string): Promise<GoalTickResult | null> {
    if (!this.eligible(graph)) return null;
    const settled = await this.settleInFlight(graph);
    if (settled) return settled;
    // An offer, not an obligation: with no turn or budget left the hand-over is
    // declined, and the system planner's own plan runs. Left to `startTurn`, the
    // limit would pause the goal instead and drop that plan.
    const policy = graph.goal.config!.manager!;
    if (
      (graph.goal.config?.managerState?.turns ?? 0) >=
        (policy.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS) ||
      (await budgetBlocked(this.ctx, graph))
    )
      return null;
    return this.startTurn(graph, undefined, reason, { declineRefused: true });
  }

  /** Return measured shortfalls to planning without weakening acceptance. */
  reconsiderAcceptance = async (
    graph: GoalGraphSnapshot,
    reason: string,
  ): Promise<GoalTickResult | null> => {
    if (!this.eligible(graph)) return null;
    if (!graph.goal.config?.managerState) return this.startTurn(graph, undefined, reason);
    const changed = await this.db.transaction(async (db) => {
      const goal = await new GoalRepository(db, this.userId, this.workspaceId).lockById(
        graph.goal.id,
      );
      const state = goal?.config?.managerState;
      if (
        !goal ||
        !activeStatuses.has(goal.status) ||
        !state?.consumed ||
        state.token !== graph.goal.config?.managerState?.token
      )
        return false;
      const current = await this.graph(db).getGraph(goal.id);
      if (!current || managerSnapshot(current) !== managerSnapshot(graph)) return false;
      await saveManagerState(db, goal.id, {
        ...state,
        readyForAcceptance: false,
        replanReason: reason,
        problem: undefined,
        problemTaskId: undefined,
      });
      return true;
    });
    return changed ? { goalId: graph.goal.id, outcome: 'advanced', message: reason } : null;
  };

  /** Shared entry conditions: a policy and its agent, an active Goal, and nobody waiting on a person. */
  private eligible = (graph: GoalGraphSnapshot) =>
    Boolean(
      graph.goal.config?.manager &&
      graph.goal.agentId &&
      activeStatuses.has(graph.goal.status) &&
      !graph.decisions.some((d) => d.status === 'pending'),
    );

  /**
   * Poll a dispatched turn. Runs on every tick regardless of who leads planning:
   * a turn already paid for has to be settled, or its plan would never land.
   */
  private settleInFlight = async (graph: GoalGraphSnapshot): Promise<GoalTickResult | null> => {
    const { goal } = graph;
    const state = goal.config?.managerState;
    if (state && !state.consumed) {
      const operation = await turnOperation(
        new AgentOperationModel(this.db, this.userId, this.workspaceId),
        state,
      );
      // An adopted local desktop run has no server operation to watch exit; its
      // submitted plan is the only settlement the server can observe.
      const settledLocally = !!state.adopted && !operation && !!state.submitted;
      // A dispatched turn never ran when its dispatch was refused the topic
      // reservation — the verdict `recordUnstartedDispatch` stored from the
      // error itself. That refusal comes before the planning message or any
      // operation is written, and the planning topic can be the owner's busy
      // conversation, which is how a turn gets stuck. With no run to confirm,
      // settle it like a turn that exited without a plan instead of pausing:
      // pausing left the Goal stuck for good, because every resume re-read this
      // same turn and paused again.
      //
      // Nothing is inferred from rows: a missing operation row proves nothing
      // (the runtime keeps going when that insert fails), and a missing planning
      // message may be one the owner deleted or one a still-pending call has not
      // written yet. Every other turn still pauses as unconfirmed; the owner can
      // confirm its exit on resume. An adopted turn is exempt.
      const neverStarted =
        !state.adopted &&
        !operation &&
        !!state.dispatchNeverStarted &&
        Date.now() - Date.parse(state.startedAt) > TIMEOUT_MS;
      if (
        !settledLocally &&
        !neverStarted &&
        (!operation || isAgentOperationInFlight(operation.status))
      ) {
        if (operation?.status === 'waiting_for_human') {
          await this.wait(goal.id, 'Main Agent is waiting for a human decision');
          return {
            goalId: goal.id,
            outcome: 'waiting_human',
            message: 'Main Agent is waiting for a human decision',
          };
        }
        if (Date.now() - Date.parse(state.startedAt) > TIMEOUT_MS) {
          return this.pause(
            goal.id,
            `Main Agent execution is unconfirmed or timed out; no replacement was dispatched. Once its run has ended, confirm and resume with: lh goal resume ${goal.id} --confirm-exit`,
          );
        }
        return this.wait(goal.id, 'Waiting for main Agent CLI planning turn');
      }
      const failed = await this.db.transaction(async (db) => {
        const fresh = await new GoalRepository(db, this.userId, this.workspaceId).lockById(goal.id);
        const current = fresh?.config?.managerState;
        if (current?.token !== state.token || current.consumed) return;
        const settled: GoalManagerState = {
          ...current,
          operationId: operation?.id ?? state.operationId,
          consumed: true,
        };
        const cleared = {
          failedTurns: undefined,
          offlineDevice: undefined,
          offlineTurns: undefined,
          retryAfter: undefined,
        };
        // A committed plan is progress whatever the run's ending; only an errored
        // turn that committed nothing gates the next dispatch.
        if (current.submitted || operation?.status !== 'error') {
          await saveManagerState(db, goal.id, { ...settled, ...cleared });
          return;
        }
        const decision = decideFailedTurn(operation.error, current);
        if (decision.action === 'pause') {
          // The person who resumes the Goal gets a fresh retry schedule. Pause in
          // this same transaction: committing the consumed receipt first would
          // let a concurrent tick claim and dispatch a replacement turn before
          // the pause took the row lock.
          await saveManagerState(db, goal.id, { ...settled, ...cleared });
          const message = `${decision.reason}. Resume with: lh goal resume ${goal.id}`;
          if (activeStatuses.has(fresh!.status)) {
            await new GoalRepository(db, this.userId, this.workspaceId).updateStatus(
              goal.id,
              'paused',
            );
            await this.graph(db).recordGoalStatus(goal.id, fresh!.status, 'paused', message);
          }
          return { ...decision, reason: message };
        }
        await saveManagerState(db, goal.id, {
          ...settled,
          failedTurns: decision.failedTurns || undefined,
          offlineDevice:
            decision.failure.kind === 'device_unavailable'
              ? readDeviceDispatchRoute(operation.error)
              : undefined,
          offlineTurns: decision.offlineTurns || undefined,
          retryAfter: decision.retryAfter,
          turns: decision.charged ? current.turns : Math.max(0, current.turns - 1),
        });
        return decision;
      });
      if (failed?.action === 'pause')
        return { goalId: goal.id, outcome: 'no_progress', message: failed.reason };
      if (failed) {
        await scheduleGoalAdvance({
          goalId: goal.id,
          userId: this.userId,
          workspaceId: this.workspaceId,
          delay: GoalWaitService.arm(failed.retryAfter).delay,
        });
        return {
          goalId: goal.id,
          outcome: 'waiting_external',
          message: `Main Agent turn failed without a plan (${failed.failure.kind}); the next turn starts after ${failed.retryAfter}`,
        };
      }
      return {
        goalId: goal.id,
        outcome: 'advanced',
        message: state.submitted
          ? 'Main Agent plan committed; normal Task coordination continues'
          : neverStarted
            ? 'Main Agent turn never started; a new bounded turn will reread durable state'
            : 'Main Agent exited without a plan; a new bounded turn will reread durable state',
      };
    }
    return null;
  };

  /**
   * Whether an UNINVITED turn must stand down. A main Agent that nobody asked for
   * may only plan when the graph is quiet, or recover a failure the transport
   * whitelist recognises — anything else is work in flight that it would preempt.
   */
  private uninvitedTurnBlocked = async (
    graph: GoalGraphSnapshot,
    unfinished: GoalGraphSnapshot['nodes'],
    tasks: TaskItem[],
  ) => {
    const failed = tasks.find((t) => t.status === 'failed');
    if (!failed) return unfinished.length > 0;
    // Supervision owns recognised transport failures, and it is both cheaper than
    // a planning turn and stricter about who authored the status. Claiming one
    // uninvited would reverse that order and spend a turn on a failure the
    // supervisor recovers on its own; whatever it declines reaches
    // `gateOrTakeOver`, which invites this Agent properly.
    if (graph.goal.config?.supervision?.enabled) return true;
    const runs = await new TaskTopicModel(this.db, this.userId, this.workspaceId).findByTaskId(
      failed.id,
    );
    const op = runs[0]?.operationId
      ? await new AgentOperationModel(this.db, this.userId, this.workspaceId).findById(
          runs[0].operationId,
        )
      : undefined;
    return !recoveryEligibility(graph, failed, op, false, countUnchargedRuns(runs)).eligible;
  };

  private startTurn = async (
    graph: GoalGraphSnapshot,
    problem?: GoalTakeoverProblem,
    continuation?: string,
    // A hand-over has the system planner's plan to fall back on, so a dispatch
    // proven never started declines instead of waiting out the turn.
    { declineRefused = false }: { declineRefused?: boolean } = {},
  ): Promise<GoalTickResult | null> => {
    const { goal } = graph;
    const policy = goal.config!.manager!;
    // The goal agent plans; `eligible` has already required one.
    const agentId = goal.agentId!;
    const state = goal.config?.managerState;
    const nodes = graph.nodes.filter((n) => n.kind === 'task');
    const unfinished = nodes.filter((n) => !terminalNodes.has(n.status));
    // An invited turn skips the checks below. They ask "should an uninvited main
    // Agent interrupt what is running", and the caller has already answered a
    // harder question: the coordinator is out of moves and the alternative is
    // stopping the Goal on a person. The acceptance guard belongs to that set too:
    // it means "verification exists, stop planning more work", which is right for an
    // uninvited turn and wrong for a takeover invited BECAUSE the terminal
    // acceptance is the thing that failed.
    if (!problem) {
      if (state?.readyForAcceptance || nodes.some((n) => n.title === GOAL_ACCEPTANCE_TASK_TITLE))
        return null;
      // A batch in flight is the coordinator's to drive: when its members settle,
      // the gate decides the next wave. A turn here would claim that moment —
      // every member is terminal, so nothing looks in flight — and the waves
      // would never release. Planning resumes once the roster is delivered.
      const batch = goal.config?.rolloutState;
      if (batch && batch.phase !== 'done') return null;
      const tasks = await new TaskModel(this.db, this.userId, this.workspaceId).findByIds(
        unfinished.flatMap((n) => (n.taskId ? [n.taskId] : [])),
      );
      const blocked = await this.uninvitedTurnBlocked(graph, unfinished, tasks);
      if (blocked) return null;
    }
    if (
      (state?.turns ?? 0) >= (policy.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS) ||
      (await budgetBlocked(this.ctx, graph))
    ) {
      // An invited turn declines instead of pausing. The caller was about to open
      // a gate carrying the actual problem; pausing here would replace that
      // question with "the main Agent is out of turns" and lose it.
      if (problem) return null;
      return this.pause(goal.id, 'Goal or main Agent turn budget exhausted');
    }
    // The previous turn failed without a plan. Its settlement already queued the
    // wakeup for this time, so a tick arriving earlier (the sweep, a Task event)
    // only reports the wait instead of queueing another one. An invited turn
    // waits too: it would fail the same way, and the problem is still there later.
    // A device seen back online ends the wait early, as it does for Tasks.
    if (
      state?.retryAfter &&
      Date.parse(state.retryAfter) > Date.now() &&
      !(await this.offlineDeviceIsBack(state))
    )
      return {
        goalId: goal.id,
        outcome: 'waiting_external',
        message: `Main Agent turn deferred until ${state.retryAfter} after a failed turn`,
      };
    const claimed = await this.db.transaction(async (db) => {
      const model = new GoalRepository(db, this.userId, this.workspaceId);
      const fresh = await model.lockById(goal.id);
      // `managerSnapshot` does not cover the goal agent, so a handoff landing
      // between the caller's graph read and this lock would otherwise dispatch
      // the previous supervisor and spend one of the new supervisor's turns.
      if (
        !fresh ||
        fresh.agentId !== agentId ||
        !activeStatuses.has(fresh.status) ||
        fresh.config?.managerState?.token !== state?.token ||
        fresh.config?.managerState?.turns !== state?.turns ||
        (fresh.config?.managerState && !fresh.config.managerState.consumed)
      )
        return;
      const current = await this.graph(db).getGraph(goal.id);
      if (!current || managerSnapshot(current) !== managerSnapshot(graph)) return;
      if (
        (fresh.config?.managerState?.turns ?? 0) >=
          (fresh.config?.manager?.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS) ||
        (await budgetBlocked(this.ctx, current, db))
      )
        return;
      // The management conversation lives in the goal agent's own history. After
      // a handoff the previous agent's topic is not this agent's to continue.
      // Read it from the LOCKED row, not the caller's graph: `moveConversationTo`
      // can have migrated the conversation between the graph read and this claim,
      // and going by the stale topic would mint a second one for the same agent.
      const freshState = fresh.config?.managerState;
      const topicModel = new TopicModel(db, this.userId, this.workspaceId);
      const previousTopic = freshState?.topicId
        ? await topicModel.findById(freshState.topicId)
        : undefined;
      const topicId =
        previousTopic?.agentId === agentId
          ? previousTopic.id
          : (
              await topicModel.create({
                agentId,
                title: `Goal management: ${goal.title}`,
                // Read from the goal page's supervision panel; keeps the planning
                // conversation out of the agent's chat sidebar and Recent.
                trigger: TopicTrigger.GoalSupervision,
              })
            ).id;
      // This claim is the other place the management topic changes (besides
      // `moveConversationTo`, which only runs between turns): a handoff that
      // landed mid-turn migrates here. The conversation being left keeps
      // counting, so it joins the history the receipt carries forward.
      const previousTopicIds = [
        ...new Set([
          ...(freshState?.previousTopicIds ?? []),
          ...(freshState?.topicId && freshState.topicId !== topicId ? [freshState.topicId] : []),
        ]),
      ];
      // The cutoff the next turn splits new from earlier feedback at. Taken before
      // the comments are read, so a comment committed while they load is never
      // dated before a turn that did not see it; at worst it is shown as new twice.
      const startedAt = new Date().toISOString();
      const reviews = await reviewFeedback(this.ctx, current, db);
      const next: GoalManagerState = {
        ...(problem
          ? {
              problem: problemKey(problem),
              ...(problem.kind && { problemKind: problem.kind }),
              ...(problem.taskId && { problemTaskId: problem.taskId }),
            }
          : {}),
        ...(state?.adoptedOperationId && { adoptedOperationId: state.adoptedOperationId }),
        ...(previousTopicIds.length > 0 && { previousTopicIds }),
        // Failure streaks span turns; settling a turn that did not error resets them.
        ...(freshState?.failedTurns && { failedTurns: freshState.failedTurns }),
        ...(freshState?.offlineTurns && { offlineTurns: freshState.offlineTurns }),
        reviewSnapshot: reviews.hash,
        topicId,
        turns: (state?.turns ?? 0) + 1,
        token: managerTurnToken(goal.id),
        snapshot: managerSnapshot(current),
        startedAt,
      };
      await saveManagerState(db, goal.id, next);
      if (fresh.status === 'planning') await model.updateStatus(goal.id, 'running');
      // Split at the previous turn's start, so the message names what is new to
      // this turn instead of resending the same comments every turn.
      // Only the latest FEEDBACK_NOTE_LIMIT are listed; the rest are counted so
      // the agent knows to read them in full rather than treating the list as all.
      const since = freshState?.startedAt ? Date.parse(freshState.startedAt) : undefined;
      const isNew = (n: (typeof reviews.notes)[number]) =>
        since === undefined || n.updatedAt.getTime() > since;
      const listed = reviews.notes.slice(-FEEDBACK_NOTE_LIMIT);
      const omitted = reviews.notes.slice(0, -FEEDBACK_NOTE_LIMIT);
      const note = ({ updatedAt, ...rest }: (typeof reviews.notes)[number]) => ({
        ...rest,
        updatedAt: updatedAt.toISOString(),
      });
      return {
        ...next,
        // Read under the lock, so a model picked just before this turn applies to it.
        modelOverride: goalModelOverride(fresh.config),
        earlierFeedback: listed.filter((n) => !isNew(n)).map(note),
        newFeedback: listed.filter(isNew).map(note),
        omittedFeedback: {
          earlier: omitted.filter((n) => !isNew(n)).length,
          new: omitted.filter(isNew).length,
        },
        previousTurn: freshState && {
          neverStarted: freshState.dispatchNeverStarted,
          plan: freshState.submitted,
        },
      };
    });
    if (!claimed) return this.wait(goal.id, 'Another advance owns the planning turn');
    try {
      const result = await new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      }).execAgent({
        agentId,
        appContext: { topicId: claimed.topicId },
        clientIds: { userMessageId: `msg_goal_manager_${claimed.token}` },
        autoStart: true,
        maxSteps: 80,
        ...claimed.modelOverride,
        userInterventionConfig: { approvalMode: 'headless' },
        prompt: buildGoalManagerPrompt({
          goalId: goal.id,
          requirement: goal.requirement ?? goal.title,
          instruction: policy.instruction,
          token: claimed.token,
          turn: claimed.turns,
          maxTurns: policy.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS,
          previousTurn: claimed.previousTurn,
          newFeedback: claimed.newFeedback,
          omittedFeedback: claimed.omittedFeedback,
          earlierFeedback: claimed.earlierFeedback,
          problem: problem?.reason,
          problemKind: problem?.kind,
          continuation:
            continuation ??
            state?.replanReason ??
            (state?.wait?.wake
              ? JSON.stringify({ reason: state.submitted?.reason, ...state.wait })
              : undefined),
        }),
      });
      await this.db.transaction(async (db) => {
        const fresh = await new GoalRepository(db, this.userId, this.workspaceId).lockById(goal.id);
        if (fresh?.config?.managerState?.token === claimed.token) {
          await saveManagerState(db, goal.id, {
            ...fresh.config.managerState,
            operationId: result.operationId,
          });
        }
      });
    } catch (error) {
      console.error(
        '[goal:manager] dispatch failed; next wakeup adopts any persisted operation',
        error,
      );
      // Only a refused topic reservation proves the turn never started: it is
      // raised before the planning message or any operation is written, and the
      // call has returned. Any other failure may come after a run went live, so
      // it stays unconfirmed. Decided from the error, never from rows the owner
      // can edit or delete.
      if (error instanceof TopicStartReservationError) {
        const recorded = await this.recordUnstartedDispatch(
          goal.id,
          claimed.token,
          declineRefused,
        ).catch((saveError) => {
          console.error('[goal:manager] failed to record the refused dispatch', saveError);
          return false;
        });
        if (recorded && declineRefused) return null;
      }
    }
    return this.wait(goal.id, 'Main Agent dispatched with CLI planning access');
  };

  /**
   * The owner confirms that the planning turn the Goal is paused on has ended,
   * so resuming can settle it and plan afresh — the repair for a turn the server
   * cannot classify on its own, including turns recorded before
   * `dispatchNeverStarted` existed. Refused while the turn's run is still live:
   * interrupt it first, or a replacement would run beside it.
   */
  confirmTurnExit = async (goalId: string) =>
    this.db.transaction(async (db) => {
      const fresh = await new GoalRepository(db, this.userId, this.workspaceId).lockById(goalId);
      const state = fresh?.config?.managerState;
      if (!state || state.consumed) return false;
      const operation = await turnOperation(
        new AgentOperationModel(db, this.userId, this.workspaceId),
        state,
      );
      if (operation && isAgentOperationInFlight(operation.status))
        throw new TRPCError({
          code: 'CONFLICT',
          message: `The main Agent run ${operation.id} is still ${operation.status}; interrupt it before confirming its exit`,
        });
      await saveManagerState(db, goalId, { ...state, consumed: true });
      return true;
    });

  /**
   * Mark a turn whose dispatch was refused its topic reservation as never
   * started; `settle` also consumes it, for a caller that will not wait it out.
   */
  private recordUnstartedDispatch = async (goalId: string, token: string, settle: boolean) =>
    this.db.transaction(async (db) => {
      const fresh = await new GoalRepository(db, this.userId, this.workspaceId).lockById(goalId);
      if (fresh?.config?.managerState?.token !== token) return false;
      await saveManagerState(db, goalId, {
        ...fresh.config.managerState,
        dispatchNeverStarted: true,
        ...(settle && { consumed: true }),
      });
      return true;
    });

  /** The verdict `submit` would reach right now; see `admission.ts`. */
  admission = async (
    goalId: string,
    input: { operationId?: string; plan?: GoalPlan; token?: string } = {},
  ): Promise<GoalPlanContext> => planAdmission(this.ctx, goalId, input);

  assertOperationOwnsTurn = async (goalId: string, operationId: string): Promise<void> =>
    assertOperationOwnsTurn(this.ctx, goalId, operationId);

  /** Apply a main Agent plan; see `submit.ts`. */
  submit = async (goalId: string, token: string, operationId: string, input: GoalPlan) =>
    submitPlan(this.ctx, goalId, token, operationId, input);
}
