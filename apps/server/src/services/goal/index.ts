import type { GoalAdvanceEffect, GoalMetricCriteriaState } from '@lobechat/agent-tracing';
import { buildGoalRequirement } from '@lobechat/builtin-tool-goal';
import {
  DEVICE_OFFLINE_RUN_STATUS,
  GOAL_BATCH_ASSAY_TITLE,
  GOAL_BATCH_TEMPLATE_TITLE,
  GOAL_BATCH_TITLE,
  GOAL_CLARIFICATION_OPTION,
  GOAL_CLARIFICATION_TITLE,
  GOAL_COORDINATOR_ACTOR_ID,
  GOAL_MACHINE_GATE_TITLE,
  PATTERN_BREAK_PAUSE_REASON,
  ROLLOUT_CANARY_SIZE_DEFAULT,
  ROLLOUT_MAX_CANARY_SIZE,
  ROLLOUT_WAVE_SIZE_DEFAULT,
} from '@lobechat/const/goal';
import type {
  ChatTopicMetadata,
  GoalConfig,
  GoalCreateConfig,
  GoalDecisionOption,
  GoalEdgeKind,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalItem,
  GoalManagerAsk,
  GoalMetricCriterion,
  GoalNodeAcceptance,
  GoalNodeKind,
  GoalNodeStatus,
  GoalPauseReason,
  GoalRolloutState,
  GoalStatus,
  GoalTickResult,
  MetricKind,
  TaskItem,
  TaskTopicHandoff,
  WorkVersionEventItem,
} from '@lobechat/types';
import { isAgentOperationInFlight } from '@lobechat/types';
import { experimentOwner, provenanceParentId } from '@lobechat/utils/goalGraph';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { MetricModel } from '@/database/models/metric';
import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';

import { readDeviceDispatchRoute } from '../aiAgent/helpers/heteroErrors';
import { deviceGateway } from '../deviceGateway';
import { TaskService } from '../task';
import { TaskRunnerService } from '../taskRunner';
import { AcceptanceService } from '../verify/acceptanceService';
import { VerifyPlanGeneratorService } from '../verify/planGenerator';
import { GoalCriteriaGeneratorService, type GoalDecompositionDraft } from './criteriaGenerator';
import {
  compareMetric,
  decideNextMove,
  frontierNeedsBudget,
  GOAL_ACCEPTANCE_TASK_TITLE,
  type GoalMove,
  LEASE_EXPIRED_ERROR,
  MEASURED_ACCEPTANCE_PAUSE_REASON,
  needsMetricCriteria,
  NO_FRONTIER_PAUSE_REASON,
  selectFrontier,
  TERMINAL_NODE_STATUSES,
} from './decideNextMove';
import { experimentResults, exploreGraph } from './exploreGraph';
import { classifyGoalFailure, isMachineFailureClass } from './failureClass';
import { GoalBriefService } from './goalBriefs';
import { lastAnsweredGateAt, planMachineRecovery } from './machineRecovery';
import { answeredProblem, GoalManagerService, problemKey } from './manager';
import {
  classifyRunFailure,
  countConsecutiveDeviceOfflineRuns,
  DEFAULT_MANAGER_MAX_TURNS,
  DEVICE_OFFLINE_GATE_REASON,
  isDeviceUnavailableFailure,
  managerTurnsSpent,
  nextDeviceOfflineRetryAt,
  QUOTA_RESET_MARGIN_MS,
  resolveMaxConcurrentTasks,
  resolveOperationLeaseTimeout,
  resolveTaskMaxSteps,
  VERIFY_SETTLE_GRACE_MS,
} from './recoveryPolicy';
import { isGoalReportNode, withoutGoalReport } from './report';
import { GoalReportService } from './reportService';
import { GoalReportStore } from './reportStore';
import { evaluateRolloutGate, type RolloutGateResult } from './rolloutGate';
import { scheduleGoalAdvance } from './scheduler';
import { evaluateHomogeneity } from './spec';
import { GoalSupervisorService } from './supervisor';
import { statusAuthoredByActor } from './supervisor/policy';
import { claimGoalTask } from './taskClaim';
import { TaskRecoveryCoordinator } from './taskRecoveryCoordinator';
import {
  type GoalTickOptions,
  toBudgetState,
  toFrontierTaskState,
  toTraceGraphState,
} from './traceObservation';
import {
  clarificationOptions,
  collectClarificationAnswers,
  hasAskedClarification,
  normalizeUnderstanding,
  UNDERSTANDING_CONFIDENCE,
} from './understanding';
import { GoalWaitService } from './wait';

const TASK_NODE_CLAIM_TTL_MS = 5 * 60 * 1000;
/**
 * Tick outcomes after which the Goal-level acceptance may have just ended: the
 * Goal was achieved, failed or canceled, or parked on a gate (an acceptance
 * whose attempts ran out opens one). Every other outcome skips the check.
 */
const REPORT_CHECK_OUTCOMES = new Set<GoalTickResult['outcome']>([
  'achieved',
  'failed',
  'waiting_human',
]);
/** A Goal whose delivery the owner can still send back for rework. */
const REOPENABLE_GOAL_STATUSES = new Set(['achieved', 'running']);
const TASK_DESCRIPTION_MAX_LENGTH = 255;
/** Ends a person reached, or the coordinator's verdict of success: nothing reopens these but `resume`. */
const GOAL_ENDED_STATUSES = new Set<string>(['achieved', 'canceled']);
/** Advisory-lock namespace for goal dispatch. `0x676f_6469` is ASCII `godi`. */
const GOAL_DISPATCH_LOCK_NAMESPACE = 0x67_6f_64_69;
/** Upper bound on a batch roster; a planner that over-lists cannot swamp the config. */
const MAX_ROLLOUT_ROSTER = 60;
/**
 * The roster the coordinator promotes from, probes first. The probe titles come
 * from the tasks actually created; the rest come from the planner's `units`,
 * de-duplicated. A planner that omitted `units` degrades to probes-only, which
 * delivers the class without a mass phase rather than inventing units.
 */
const normalizeRolloutRoster = (
  units: string[] | undefined,
  probeDrafts: GoalDecompositionDraft['tasks'],
  canarySize: number,
): string[] => {
  const probeTitles = probeDrafts.slice(0, canarySize).map((draft) => draft.title);
  const seen = new Set(probeTitles);
  const rest: string[] = [];
  for (const unit of units ?? []) {
    const title = unit.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    rest.push(title);
    if (probeTitles.length + rest.length >= MAX_ROLLOUT_ROSTER) break;
  }
  return [...probeTitles, ...rest];
};

/**
 * Materialize one roster unit as a Task inside a batch. The brief is the shared
 * recipe applied to this unit — the probes carry the full first-hand brief, the
 * units promoted later reuse what the Template already proved.
 */
const createRecipeUnitTask = async (
  writer: GoalGraphModel,
  goalId: string,
  batchNodeId: string,
  title: string,
  recipeOutline?: string,
): Promise<string | undefined> => {
  const node = await writer.createNode(goalId, {
    description: [recipeOutline, `Unit: ${title}`].filter(Boolean).join('\n\n'),
    kind: 'task',
    scopeId: batchNodeId,
    title,
  });
  return node?.id;
};

/** Who does the goal's Tasks: its dedicated executor, else the goal agent itself. */
export const goalTaskAgentId = (goal: Pick<GoalItem, 'agentId' | 'config'>) =>
  goal.config?.taskAgentId ?? goal.agentId ?? undefined;

export interface CreateGoalTaskInput {
  description?: string;
  title: string;
}

export interface CreateGoalGraphInput {
  /**
   * The goal agent: it supervises the goal, runs its planning turns and does its
   * Tasks unless `config.taskAgentId` names a dedicated executor. Defaults to
   * `createdByAgentId`.
   */
  agentId?: string;
  config?: GoalCreateConfig;
  /**
   * The agent that made this call, when a tool did. Distinct from `agentId`,
   * which is the agent the goal belongs to — creating a goal from the modal on
   * an agent's page sets that, but the author is still the person.
   */
  createdByAgentId?: string;
  /**
   * Structured acceptance criteria. Persisted as `verify_criteria` rows and
   * recorded on `config.acceptance.criteriaIds`, so the goal page can show and
   * edit them and the terminal Goal-acceptance Task verifies against exactly
   * these checks. Callers still fold the same criteria into `requirement`
   * prose — that text remains what every Task's execution context reads.
   */
  criteria?: Array<{ description?: string; instruction?: string; title: string }>;
  maxRounds?: number;
  maxTotalCost?: number;
  /**
   * The user's ask in their own words, shown on the seeded problem node. The
   * full `requirement` (with its acceptance boilerplate) stays on the goal row
   * — copying it onto the node made every drill-down read like a contract.
   */
  problemDescription?: string;
  projectId?: string;
  requirement?: string;
  /**
   * Seed task nodes, in dependency-free order. A plain string is title-only.
   * When omitted, the coordinator plans the decomposition on first advance.
   */
  tasks?: Array<CreateGoalTaskInput | string>;
  title: string;
  /**
   * The conversation this goal was created from. Recorded as the goal's
   * `topic` subject so the conversation can find and show it.
   */
  topicId?: string;
}

export interface CreateGoalNodeInput {
  description?: string;
  kind: GoalNodeKind;
  priority?: number;
  questionId?: string;
  scopeId?: string;
  status?: GoalNodeStatus;
  title: string;
}

/** Application service shared by CLI today and Graph UI/schedulers later. */
/**
 * Version events read per task run when harvesting deliverables. Generous
 * because the cap applies to events rather than to Works: the newest N events
 * of a run must still contain every Work it produced, even one revised many
 * times over.
 */
const DELIVERABLE_EVENTS_PER_RUN = 200;

/**
 * What answering a gate does to the Task it was opened for. The coordinator's
 * own options say it through their fixed ids; an option the main Agent wrote
 * for its own question names its effect, and one that names none only records
 * the answer — the Agent reads it on its next turn.
 */
const decisionOptionEffect = (
  option: GoalDecisionOption | undefined,
  sourceTitle?: string,
): 'fail' | 'retire' | 'retry' | undefined => {
  if (!option) return undefined;
  if (option.effect) return option.effect;
  if (option.id === 'retry' || option.id === 'retire') return option.id;
  if (option.id === 'fail' && sourceTitle === GOAL_ACCEPTANCE_TASK_TITLE) return 'fail';
  return undefined;
};

/**
 * The comment a retried Task carries into its next attempt. A bare "retry"
 * adds nothing the run does not already know; a chosen direction or a note is
 * exactly what the owner wants the next attempt to act on.
 */
const decisionGuidance = (
  question: string,
  option: GoalDecisionOption | undefined,
  note?: string,
): string | undefined => {
  const custom = option && option.id !== 'retry' ? option : undefined;
  const trimmed = note?.trim();
  if (!custom && !trimmed) return undefined;
  return [
    'Owner decision on the recovery gate for this Task.',
    `Question: ${question}`,
    custom
      ? `Chosen: ${custom.label}${custom.description ? ` — ${custom.description}` : ''}`
      : undefined,
    trimmed ? `Guidance: ${trimmed}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
};

export class GoalService {
  private readonly acceptanceService: AcceptanceService;
  private readonly agentModel: AgentModel;
  /** What the goal tells the person through the inbox: gates, sign-off, findings. */
  private readonly briefs: GoalBriefService;
  private readonly goalModel: GoalModel;
  /**
   * Graph writes attributed to the person who asked for them: seeding a goal,
   * adding a node or edge by hand, resolving a decision gate.
   */
  private readonly graphModel: GoalGraphModel;
  /**
   * Graph writes the coordinator makes on its own — claiming a Task node,
   * binding its task, synthesizing a finding, opening a gate. Attributed to the coordinator
   * even when a person pressed Advance: they asked it to run, they did not make
   * these moves.
   */
  private readonly coordinatorGraph: GoalGraphModel;
  private readonly taskModel: TaskModel;
  private readonly taskService: TaskService;
  private readonly taskTopicModel: TaskTopicModel;
  private readonly workModel: WorkModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.acceptanceService = new AcceptanceService(db, userId, workspaceId);
    this.agentModel = new AgentModel(db, userId, workspaceId);
    this.briefs = new GoalBriefService(db, userId, workspaceId);
    this.goalModel = new GoalModel(db, userId, workspaceId);
    this.graphModel = new GoalGraphModel(db, userId, workspaceId);
    this.coordinatorGraph = new GoalGraphModel(db, userId, workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.taskService = new TaskService(db, userId, workspaceId);
    this.taskTopicModel = new TaskTopicModel(db, userId, workspaceId);
    this.workModel = new WorkModel(db, userId, workspaceId);
  }

  /**
   * The graph model whose audit trail names `agentId` as the author, or the
   * user-attributed one when a person is calling.
   */
  private graphAs = (agentId?: string) =>
    agentId
      ? new GoalGraphModel(this.db, this.userId, this.workspaceId, { id: agentId, type: 'agent' })
      : this.graphModel;

  /**
   * `/goal` in a conversation: the agent running there creates the goal and
   * supervises it from that conversation.
   *
   * Identity comes from the running operation, never from the caller: the goal
   * agent is the operation's agent, the conversation is its topic, and that very
   * run becomes the first planning turn, so the agent can plan straight away with
   * the returned token instead of waiting for a dispatched turn.
   */
  createFromConversation = async (
    operationId: string,
    input: Omit<CreateGoalGraphInput, 'agentId' | 'createdByAgentId' | 'topicId'>,
    /**
     * A local desktop run keeps its operation client-side, so no server row
     * exists for `operationId`. Its conversation env names the topic and agent
     * instead; they are accepted only when the topic is the caller's and belongs
     * to that agent. Never used for operation-token callers.
     */
    localRun?: { agentId: string; topicId: string },
  ): Promise<{ graph: GoalGraphSnapshot; turnToken: string }> => {
    const { agentId, topicId } = await this.resolveTopicRun(
      operationId,
      localRun,
      'Only a run in a topic with an agent can create a goal it supervises',
    );

    const created = await this.create({
      ...input,
      agentId,
      config: { ...input.config, manager: input.config?.manager ?? {} },
      createdByAgentId: agentId,
      topicId,
    });
    try {
      const state = await new GoalManagerService(
        this.db,
        this.userId,
        this.workspaceId,
      ).adoptConversationTurn(created.goal.id, { operationId, topicId });
      return { graph: (await this.graphModel.getGraph(created.goal.id))!, turnToken: state.token };
    } catch (error) {
      // A goal nobody can plan is worse than no goal: the agent would report it
      // created while its supervisor never gets a turn.
      await this.goalModel.delete(created.goal.id).catch(() => {});
      throw error;
    }
  };

  /**
   * The agent and topic of the run with this id, taken from the server's
   * operation row; never from the caller while that row exists. A local desktop
   * run has no row, so its env-provided topic and agent are accepted only when
   * the topic is the caller's and belongs to that agent.
   */
  private resolveTopicRun = async (
    operationId: string,
    localRun: { agentId: string; topicId: string } | undefined,
    noAgentMessage: string,
  ): Promise<{ agentId: string; topicId: string }> => {
    const operation = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findOwnOperationById(operationId);
    if (operation) {
      if (operation.status !== 'running')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The conversation run has already ended',
        });
      if (!operation.agentId || !operation.topicId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: noAgentMessage });
      return { agentId: operation.agentId, topicId: operation.topicId };
    }
    const topic = localRun
      ? await new TopicModel(this.db, this.userId, this.workspaceId).findOwnTopicById(
          localRun.topicId,
        )
      : undefined;
    if (!localRun || !topic || topic.agentId !== localRun.agentId)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
    return { agentId: localRun.agentId, topicId: topic.id };
  };

  /**
   * Attach an existing goal to the topic of the run with this id, so it
   * is supervised from there exactly as if it had been created there with
   * `/goal`: the topic's agent becomes the goal agent, the topic
   * becomes its `topic` subject and management topic. Graph, Tasks,
   * budgets and status are kept. A change of goal agent moves unfinished Tasks
   * the way `setAgent` does (unless `goalOnly`, or the goal has a dedicated
   * executor). Returns a `turnToken` when the binding run was adopted as a
   * planning turn.
   */
  bindTopic = async (
    goalId: string,
    operationId: string,
    options?: {
      force?: boolean;
      goalOnly?: boolean;
      /** A local desktop run's topic; see `resolveTopicRun`. */
      localRun?: { agentId: string; topicId: string };
    },
  ) => {
    const { agentId, topicId } = await this.resolveTopicRun(
      operationId,
      options?.localRun,
      'Only a run in a topic with an agent can supervise a goal',
    );
    // A run row names its topic, but the topic must still be the caller's and
    // the run's agent's: the binding makes that agent plan into it.
    const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findOwnTopicById(
      topicId,
    );
    if (!topic || topic.agentId !== agentId)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
    await assertAgentUsableBy(this.db, agentId, {
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    // One transaction: the agent change and the Task moves it implies commit
    // together. Committed apart, a failed move left the goal already on the new
    // agent, and the retry — seeing no agent change — never moved the Tasks.
    const { bound, reassignedTaskIds } = await this.db.transaction(async (tx) => {
      const bound = await new GoalManagerService(tx, this.userId, this.workspaceId).bindTopic(
        goalId,
        { agentId, operationId, topicId },
        { force: options?.force },
      );
      const reassignedTaskIds =
        bound.previousAgentId === agentId
          ? []
          : await new GoalService(tx, this.userId, this.workspaceId).followGoalAgent(
              bound.goal,
              agentId,
              options?.goalOnly,
            );
      return { bound, reassignedTaskIds };
    });
    return {
      graph: await this.requireGraph(goalId),
      previousSubject: bound.previousSubject,
      reassignedTaskIds,
      topicId,
      turnToken: bound.turnToken,
    };
  };

  create = async (input: CreateGoalGraphInput): Promise<GoalGraphSnapshot> => {
    if (input.agentId ?? input.createdByAgentId) {
      await assertAgentUsableBy(this.db, (input.agentId ?? input.createdByAgentId)!, {
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    }
    if (input.projectId) {
      const project = await new ProjectModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).findManageableById(input.projectId);
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    }
    // Persist the structured acceptance criteria first: their ids ride on the
    // goal config so the page can edit them and the terminal acceptance Task
    // is gated on exactly these checks (not an AI re-derivation of the prose).
    // The goal's agent supervises it: it owns the goal list entry, the page and,
    // in manager mode, every planning turn. An agent creating a goal for itself
    // need not repeat its id; executors are routed separately (`taskAgentId`).
    const goalAgentId = input.agentId ?? input.createdByAgentId;
    const { manager: managerOptions, taskAgentId, ...options } = input.config ?? {};
    const managed = managerOptions !== undefined;
    let config: GoalConfig | undefined = input.config ? options : undefined;
    if (taskAgentId && taskAgentId !== goalAgentId) {
      await assertAgentUsableBy(this.db, taskAgentId, {
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      config = { ...config, taskAgentId };
    }
    if (managed) {
      if (!goalAgentId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A main Agent requires the goal agent',
        });
      }
      const turns = managerOptions?.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS;
      if (!Number.isInteger(turns) || turns < 1 || turns > 100)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Main Agent requires 1–100 management turns',
        });
      // Exploration, supervision and seed tasks used to be rejected here, on the
      // premise that a main Agent owns planning outright. They are layers, not
      // rivals: the system planner leads, supervision recovers known transport
      // failures, and the main Agent is handed whatever neither can route (see
      // `gateOrTakeOver`). Ordering resolves what exclusivity used to.
      // Rebuilt from the known fields: a legacy caller may still send an
      // `agentId` inside the policy, and the planning identity is the goal's.
      config = {
        ...config,
        manager: { instruction: managerOptions?.instruction, maxTurns: managerOptions?.maxTurns },
      };
    }
    // Supervision is a creation invariant, not a creation option: every Goal
    // recovers its own dropped dispatches, so a caller may tune the incident cap
    // but never opt out. This is the single choke point — the CLI, the `/goal`
    // tool, tRPC and REST all land here — so no client can create an
    // unsupervised Goal. A legacy `enabled: false` is rejected rather than
    // silently rewritten: the caller asked for the opposite of what it would
    // get, and hiding that would make the surprise surface later, mid-run.
    const requestedSupervision = config?.supervision;
    if (requestedSupervision?.enabled === false)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Supervision is required for every goal and cannot be disabled',
      });
    config = {
      ...config,
      supervision: {
        enabled: true,
        ...(requestedSupervision?.maxIncidents === undefined
          ? {}
          : { maxIncidents: requestedSupervision.maxIncidents }),
      },
    };
    // A supplied requirement is the user-reviewed goal document. Criteria live
    // separately; only synthesize a document when the caller omitted one.
    const requirement =
      input.requirement ??
      (input.criteria?.length ? buildGoalRequirement(input.title, input.criteria) : undefined) ??
      (input.config?.exploration ? input.title : undefined);
    if (config?.exploration) {
      const { maxExperiments, instruction } = config.exploration;
      if (
        !Number.isInteger(maxExperiments) ||
        maxExperiments < 1 ||
        maxExperiments > 200 ||
        !instruction.trim()
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Exploration requires an instruction and 1–200 experiments',
        });
      }
      if ((input.tasks?.length ?? 0) > maxExperiments) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Initial tasks exceed the experiment limit',
        });
      }
      config = { ...config, exploration: { maxExperiments, instruction } };
    }
    if (input.criteria?.length) {
      const criteriaIds = await new VerifyPlanGeneratorService(
        this.db,
        this.userId,
        this.workspaceId,
      ).createCriteriaFromDrafts(
        input.criteria.map((item) => ({
          description: item.description,
          instruction: item.instruction,
          onFail: 'manual',
          required: true,
          title: item.title,
          verifierType: 'agent',
        })),
      );
      // Merge, never replace: `acceptance` also carries the numeric clauses,
      // and rebuilding the object from `criteriaIds` alone would drop a
      // measured gate the caller asked for in the same call.
      config = { ...config, acceptance: { ...config?.acceptance, criteriaIds } };
    }

    const goal = await this.goalModel.create({
      agentId: goalAgentId,
      config,
      maxRounds: input.maxRounds,
      maxTotalCost: input.maxTotalCost,
      projectId: input.projectId,
      requirement,
      ...(input.topicId
        ? { subjectId: input.topicId, subjectType: 'topic' as const }
        : { subjectType: 'standalone' as const }),
      title: input.title,
    });
    // `/goal` is an agent making the call. Seeding through the user-attributed
    // model would file the whole opening graph under the goal's owner, which is
    // the same loss of authorship the coordinator split just fixed.
    const authorGraph = this.graphAs(input.createdByAgentId);

    try {
      const problem = await authorGraph.createNode(goal.id, {
        createdByAgentId: input.createdByAgentId,
        description: input.problemDescription ?? input.requirement,
        kind: 'problem',
        status: 'active',
        title: input.title,
      });
      if (!problem) throw new Error('Failed to seed goal problem');

      // An exploration baseline is the goal's first candidate answer, so it
      // lives inside an experiment container the explorer can branch from.
      // Caller-supplied seed tasks are ordinary work: they attach straight to
      // the problem the way a planned or manager-submitted task does.
      if (config?.exploration && !input.tasks) {
        const description = `Produce one initial baseline experiment for this Goal. ${input.problemDescription ?? requirement ?? input.title}\nExploration method: ${config.exploration.instruction}\nExecute the baseline only; later experiments are scheduled by the Goal coordinator. Include a self-contained result and evidence.`;
        const experiment = await authorGraph.createNode(goal.id, {
          kind: 'experiment',
          title: input.title,
          description,
          questionId: problem.id,
          createdByAgentId: input.createdByAgentId,
        });
        if (!experiment) throw new Error('Failed to seed experiment');
        const taskNode = await authorGraph.createNode(goal.id, {
          scopeId: experiment.id,
          createdByAgentId: input.createdByAgentId,
          description,
          kind: 'task',
          title: input.title,
        });
        if (!taskNode) throw new Error('Failed to seed goal task');
      }
      for (const seed of input.tasks ?? []) {
        const { description, title } = typeof seed === 'string' ? { title: seed } : seed;
        const taskNode = await authorGraph.createNode(goal.id, {
          createdByAgentId: input.createdByAgentId,
          description,
          kind: 'task',
          title,
        });
        if (!taskNode) throw new Error('Failed to seed goal task');
        await authorGraph.createEdge(goal.id, problem.id, taskNode.id, 'decomposes');
      }
    } catch (error) {
      await this.goalModel.delete(goal.id).catch(() => {});
      throw error;
    }
    return (await this.graphModel.getGraph(goal.id))!;
  };

  /**
   * Replace the goal's structured acceptance criteria id list (goal-page
   * editing). The criteria rows themselves are edited through the verify
   * criteria endpoints; this only rebinds which of them gate the goal.
   */
  /**
   * Declare (or clear) the numeric clauses that gate this goal's acceptance.
   *
   * Merged into `config.acceptance` so it cannot clobber the delivery criteria
   * binding, and settable after creation because a long-horizon goal learns its
   * real thresholds while it runs. Relaxing a clause can unblock a goal that is
   * already parked short of acceptance — the same reason extending a deadline
   * resumes a budget-stopped one — so the caller schedules an advance.
   */
  /**
   * Write a measurement against this goal, and reopen it when that measurement
   * is what it was waiting for.
   *
   * The gate parks the goal (see the `measured_acceptance` branch), and `tick`
   * refuses to move a paused goal — so without the reopen here the observation
   * would land and nothing would happen. Only a goal the gate actually stopped
   * is reopened, and only once every clause holds: the same discipline
   * `setBudget` uses, so a deliberate pause is never undone by a stray sample
   * and a still-short measurement does not queue a no-op advance.
   */
  recordObservation = async (
    goalId: string,
    input: {
      key: string;
      kind?: MetricKind;
      observedAt?: Date;
      title?: string;
      unit?: string;
      value: number;
    },
  ) => {
    const goal = await this.goalModel.findById(goalId);
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

    const metricModel = new MetricModel(this.db, this.userId, this.workspaceId);
    const series = await metricModel.ensure({
      key: input.key,
      kind: input.kind,
      subjectId: goal.id,
      subjectType: 'goal',
      title: input.title,
      unit: input.unit,
    });
    if (!series)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Metric series slot is owned by another scope',
      });

    const point = await metricModel.addPoint(series.id, {
      actorId: this.userId,
      actorType: 'user',
      observedAt: input.observedAt ?? new Date(),
      sourceType: 'manual',
      value: input.value,
    });

    const manager = goal.config?.managerState;
    if (
      manager?.wait &&
      point &&
      new Date(point.observedAt).getTime() >= Date.parse(manager.startedAt)
    ) {
      await new GoalWaitService(this.db, this.userId, this.workspaceId).deliver(goalId, {
        waitToken: manager.token,
        eventId: point.id,
        type: 'metric.observed',
        key: input.key,
        reference: series.id,
        summary: `${input.key} = ${input.value} at ${point.observedAt}`,
      });
    }
    return { point, series, shouldAdvance: await this.reopenIfMeasurementCleared(goalId) };
  };

  /**
   * Whether the coordinator is worth waking: either the goal is already
   * running, or the coordinator itself parked it on a measured gate that no
   * longer holds it.
   *
   * The `pausedBy` marker is what makes this safe. A goal paused by a person
   * looks exactly like one parked by the gate — same status, same terminal
   * phase, same clauses — so without it an arriving measurement would restart
   * a goal somebody deliberately stopped.
   *
   * "No longer holds it" covers both ways out: every clause now satisfied, and
   * the clauses being dropped altogether (`setMetricCriteria(id, [])`), which
   * otherwise left the goal parked on a gate that no longer existed.
   */
  private reopenIfMeasurementCleared = async (
    goalId: string,
    /**
     * Whether the gate held the goal *before* the caller's edit, for callers
     * that change the clauses themselves: dropping the last one erases the
     * evidence, so the verdict is taken from the state that preceded it — the
     * same way `setBudget` reads what was binding before it wrote.
     */
    parkedBeforeEdit?: boolean,
  ): Promise<boolean> => {
    const graph = await this.coordinatorGraph.getGraph(goalId);
    if (!graph) return false;
    if (graph.goal.status !== 'paused') return true;
    if (!(parkedBeforeEdit ?? this.isParkedOnMeasuredGate(graph))) return false;

    if (needsMetricCriteria(graph)) {
      const { allMet } = await this.evaluateMetricCriteria(graph);
      if (!allMet) return false;
    }

    await this.setPauseReason(goalId, undefined);
    await this.transitionStatus(graph.goal, 'running', 'a measurement cleared the acceptance gate');
    return true;
  };

  /**
   * Record (or clear) why the coordinator is holding this goal paused.
   *
   * Kept on the goal's JSONB config rather than derived from the event log:
   * control flow should not depend on a capped audit trail, and the marker has
   * to survive for as long as the pause does — which for a long-horizon goal
   * is the whole wait.
   */
  private setPauseReason = async (goalId: string, reason: GoalPauseReason | undefined) => {
    await this.goalModel.updatePauseReason(goalId, reason);
  };

  /**
   * Whether the coordinator is the one holding this paused goal.
   *
   * The marker answers it outright. Goals parked before the marker existed —
   * and any parked by an old worker mid-deploy — carry none, so fall back to
   * who performed the transition: every status change records a goal-entity
   * event, and the newest one is by definition the transition that produced
   * the current status. A coordinator park is attributed to `system`, a user
   * pause to `user`, so the two stay distinguishable without the marker.
   *
   * Absent both, the pause is left alone: a goal wrongly resumed spends money
   * against an explicit human decision, while one left parked says so on its
   * row and is one Resume away.
   */
  private isParkedOnMeasuredGate = (graph: GoalGraphSnapshot): boolean => {
    if (graph.goal.status !== 'paused') return false;
    if (graph.goal.config?.pausedBy) return graph.goal.config.pausedBy === 'measured_acceptance';

    // Match the park this gate actually recorded, not merely "the coordinator
    // paused it": it also parks goals that are blocked or out of budget, and an
    // unrelated sample must not restart either. The newest goal-entity event is
    // by definition the transition that produced the current status; if two
    // share a millisecond and the read picks the other one, the result is a
    // missed reopen rather than a wrongful one.
    const lastTransition = graph.events.find((event) => event.entityType === 'goal');
    return (
      lastTransition?.actorType !== 'user' &&
      !!lastTransition?.reason?.startsWith(MEASURED_ACCEPTANCE_PAUSE_REASON) &&
      needsMetricCriteria(graph)
    );
  };

  setMetricCriteria = async (
    goalId: string,
    metrics: GoalMetricCriterion[],
    /**
     * `merge` upserts by key into the list as it stands on the server —
     * for callers declaring one clause, whose own snapshot may be stale.
     * A client-built replacement array would silently drop whatever a
     * concurrent editor or agent declared since that snapshot was read.
     */
    mode: 'merge' | 'replace' = 'replace',
  ) => {
    const before = await this.coordinatorGraph.getGraph(goalId);
    if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    const parkedOnGate = this.isParkedOnMeasuredGate(before);
    const goal = before.goal;
    const current = goal.config?.acceptance?.metrics ?? [];
    const next =
      mode === 'merge'
        ? [...current.filter((item) => !metrics.some((m) => m.key === item.key)), ...metrics]
        : metrics;
    await this.goalModel.update(goalId, {
      config: {
        ...goal.config,
        acceptance: {
          ...goal.config?.acceptance,
          metrics: next.length > 0 ? next : undefined,
        },
      },
    });
    // Relaxing or dropping a clause can clear a gate the goal is parked on.
    await this.reopenIfMeasurementCleared(goalId, parkedOnGate);
    return this.graph(goalId);
  };

  setAcceptanceCriteria = async (goalId: string, criteriaIds: string[]) => {
    const goal = await this.goalModel.findById(goalId);
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    await this.goalModel.update(goalId, {
      config: { ...goal.config, acceptance: { ...goal.config?.acceptance, criteriaIds } },
    });

    // A terminal Goal-acceptance Task may already be dispatched — its
    // Acceptance row snapshotted the previous id list. Rebind it too, or the
    // page would present the new criteria as gates while the verifier keeps
    // materializing plans from the stale list. A verify round already
    // materialized for an in-flight run stays as-is (rounds are immutable
    // snapshots); every later run instantiates from the updated config.
    const graph = await this.graphModel.getGraph(goalId);
    const terminalTaskId = graph?.nodes.find(
      (node) => node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE && node.taskId,
    )?.taskId;
    if (!terminalTaskId) return;

    const acceptance = await this.acceptanceService.acceptanceModel.findBySubject(
      'task',
      terminalTaskId,
    );
    if (!acceptance || acceptance.status === 'accepted') return;
    await this.acceptanceService.acceptanceModel.update(acceptance.id, {
      config: {
        ...acceptance.config,
        ...(criteriaIds.length > 0
          ? { verifyCriteriaIds: criteriaIds }
          : { verifyCriteriaIds: undefined }),
      },
    });
  };

  graph = async (goalId: string) => {
    const graph = await this.requireGraph(goalId);
    const [runHeartbeats, deliveredAt, acceptances, assignees, spend, report] = await Promise.all([
      this.collectRunHeartbeats(graph),
      this.collectDeliveredAt(graph),
      this.collectAcceptances(graph),
      this.collectAssignees(graph),
      this.resolveSpend(graph),
      new GoalReportStore(this.db, this.userId, this.workspaceId).state(graph),
    ]);
    return { ...graph, acceptances, assignees, deliveredAt, report, runHeartbeats, spend };
  };

  /**
   * The agent each dispatched task node is assigned to. Read from the Task row
   * rather than the goal config: a task can be reassigned on its own, and the
   * row is what the runner actually dispatches to.
   */
  private collectAssignees = async (
    graph: GoalGraphSnapshot,
  ): Promise<Record<string, string> | undefined> => {
    const taskNodes = graph.nodes.filter(
      (node): node is GoalGraphNode & { taskId: string } => node.kind === 'task' && !!node.taskId,
    );
    if (taskNodes.length === 0) return undefined;

    const nodeByTaskId = new Map(taskNodes.map((node) => [node.taskId, node.id]));
    // Runs on every graph poll: read the one column, not whole task rows.
    const tasks = await this.taskModel.findAssigneesByIds(taskNodes.map((node) => node.taskId));

    const result: Record<string, string> = {};
    for (const task of tasks) {
      const nodeId = nodeByTaskId.get(task.id);
      if (nodeId && task.assigneeAgentId) result[nodeId] = task.assigneeAgentId;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };

  /**
   * The coordinator calls a goal achieved once its own acceptance passes, but
   * the person who asked for it has not said so yet. Ask them — wherever they
   * are — through the inbox, tied to the Goal-level acceptance they sign.
   */
  private requestSignOff = async (graph: GoalGraphSnapshot) => {
    const terminal = graph.nodes.find(
      (node) => node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE && !!node.taskId,
    );
    if (!terminal) return;
    const acceptance = (await this.collectAcceptances(graph))?.[terminal.id];
    if (!acceptance) return;
    // `openSignOff` re-reads the acceptance under a row lock: one the owner
    // already signed asks nothing.
    await this.briefs.openSignOff(graph.goal, acceptance.id);
  };

  /**
   * Verification state per task node.
   *
   * Every dispatched task already owns an Acceptance (`createResponsibleTask`
   * creates one), but the goal surfaced only the criteria it would be judged
   * against — never the judgment. A reader could see that a task finished and
   * still have no idea whether it held up, which is the gap that made the page
   * feel unverifiable.
   *
   * Each level's tally rides along so the page can show its standing without
   * opening it. That tally is counted from the same check union the level
   * expands to (so a summary row can never contradict its own list), and it is
   * one batched read, never one per acceptance — this runs on every graph poll.
   */
  private collectAcceptances = async (
    graph: GoalGraphSnapshot,
  ): Promise<Record<string, GoalNodeAcceptance> | undefined> => {
    const taskNodes = graph.nodes.filter(
      (node): node is GoalGraphNode & { taskId: string } => node.kind === 'task' && !!node.taskId,
    );
    if (taskNodes.length === 0) return undefined;

    const nodeByTaskId = new Map(taskNodes.map((node) => [node.taskId, node.id]));
    const rows = await this.acceptanceService.acceptanceModel.findBySubjects(
      'task',
      taskNodes.map((node) => node.taskId),
    );

    // An acceptance with no round yet is absent from the tally map, not zero —
    // keep "no round" and "judged nothing" apart on the page.
    const tallies = await this.acceptanceService.getCheckTalliesByAcceptances(
      rows.map((row) => row.id),
    );

    const result: Record<string, GoalNodeAcceptance> = {};
    for (const row of rows) {
      const nodeId = nodeByTaskId.get(row.subjectId);
      if (!nodeId) continue;
      const checks = tallies.get(row.id);
      result[nodeId] = { id: row.id, status: row.status, ...(checks ? { checks } : {}) };
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };

  /**
   * When an active task node's newest run delivered, for the nodes waiting on
   * verification to settle.
   *
   * A verify-bound task keeps its node `active` while its topic is already
   * `completed`, and the judgment is a full agent run that routinely outlives
   * the operation lease — `decideNextMove` holds off re-dispatching such a node
   * for a whole `VERIFY_SETTLE_GRACE_MS`. But a completed topic is not a
   * *running* one, so it contributes no heartbeat, and a client judging
   * liveness from heartbeats alone declared the goal's most informative moment
   * — delivered, being verified — lost. Reporting the delivery instant lets the
   * client name that state and apply the coordinator's own grace window instead
   * of the lease.
   */
  private collectDeliveredAt = async (
    graph: GoalGraphSnapshot,
  ): Promise<Record<string, Date> | undefined> => {
    const activeTasks = graph.nodes.filter(
      (node): node is GoalGraphNode & { taskId: string } =>
        node.kind === 'task' && node.status === 'active' && !!node.taskId,
    );
    if (activeTasks.length === 0) return undefined;

    const nodeByTaskId = new Map(activeTasks.map((node) => [node.taskId, node.id]));
    // Newest run per task: `findWithHandoffByTaskIds` orders by seq desc, so the
    // first row seen for a task is its latest.
    const topics = await this.taskTopicModel.findWithHandoffByTaskIds(
      activeTasks.map((n) => n.taskId),
      activeTasks.length,
    );

    const delivered: Record<string, Date> = {};
    const seen = new Set<string>();
    for (const topic of topics) {
      const taskId = topic.sourceTaskId;
      if (!taskId || seen.has(taskId)) continue;
      seen.add(taskId);
      const nodeId = nodeByTaskId.get(taskId);
      // Only the newest run counts, and only while it is a delivery: an older
      // completed run under a newer running one is history, not a pending
      // verification.
      if (!nodeId || topic.status !== 'completed') continue;
      delivered[nodeId] = topic.completedAt ?? topic.createdAt;
    }

    return Object.keys(delivered).length > 0 ? delivered : undefined;
  };

  /**
   * Live heartbeat per active task node: the `agent_operations.updatedAt` of
   * the run behind it. The runtime refreshes that lease every ~90s while
   * `goal_nodes.updatedAt` only moves on observations / status changes, so a
   * client judging liveness from the node row alone would cry "lost" over any
   * long quiet stretch (a big tool call, the verify stage) the reclaim path
   * considers perfectly healthy.
   */
  private collectRunHeartbeats = async (
    graph: GoalGraphSnapshot,
  ): Promise<Record<string, Date> | undefined> => {
    const activeTasks = graph.nodes.filter(
      (node): node is GoalGraphNode & { taskId: string } =>
        node.kind === 'task' && node.status === 'active' && !!node.taskId,
    );
    if (activeTasks.length === 0) return undefined;

    const nodeByTaskId = new Map(activeTasks.map((node) => [node.taskId, node.id]));
    const running = await this.taskTopicModel.findRunningByTaskIds(
      activeTasks.map((n) => n.taskId),
    );

    // One batched read: the graph polls every few seconds per open client, so
    // a per-topic operation lookup would scale queries with task concurrency.
    const operationIds = [
      ...new Set(running.flatMap((topic) => (topic.operationId ? [topic.operationId] : []))),
    ];
    const operations = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findByIds(operationIds);
    const operationById = new Map(operations.map((operation) => [operation.id, operation]));

    const heartbeats: Record<string, Date> = {};
    for (const topic of running) {
      const nodeId = topic.taskId ? nodeByTaskId.get(topic.taskId) : undefined;
      if (!nodeId || !topic.operationId || heartbeats[nodeId]) continue;
      const updatedAt = operationById.get(topic.operationId)?.updatedAt;
      if (updatedAt) heartbeats[nodeId] = updatedAt;
    }

    return Object.keys(heartbeats).length > 0 ? heartbeats : undefined;
  };

  /** Current lifecycle status, without paying for the whole graph. */
  status = async (goalId: string): Promise<GoalStatus | undefined> =>
    (await this.goalModel.findById(goalId))?.status;

  addNode = async (goalId: string, input: CreateGoalNodeInput) => {
    const node = await this.graphModel.createNode(goalId, input);
    if (!node) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return node;
  };

  addEdge = async (
    goalId: string,
    sourceNodeId: string,
    targetNodeId: string,
    kind: GoalEdgeKind,
  ) => {
    const edge = await this.graphModel.createEdge(goalId, sourceNodeId, targetNodeId, kind);
    if (!edge) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return edge;
  };

  /**
   * Stop everything the goal has running, then delete it and its graph.
   *
   * Deleting only the goal row cascades the graph away but leaves each graph
   * Task — and the agent operation behind it — running, spending the user's
   * budget with nothing left on screen to stop it. The tasks themselves stay:
   * they are ordinary tasks with their own history and acceptance.
   */
  delete = async (goalId: string) => {
    let graph = await this.graphModel.getGraph(goalId);
    const managed = !!graph?.goal.config?.manager;
    const supervised =
      !!graph?.goal.config?.supervision?.enabled || !!graph?.goal.config?.supervisorState;
    if (managed || supervised) {
      // Fence new claims before cancellation, then read the latest claimed turn.
      await this.db.transaction(async (db) => {
        const model = new GoalModel(db, this.userId, this.workspaceId);
        const current = await model.lockById(goalId);
        if (current && current.status !== 'paused') {
          await model.updateStatus(goalId, 'paused');
          await new GoalGraphModel(db, this.userId, this.workspaceId).recordGoalStatus(
            goalId,
            current.status,
            'paused',
            'Stopping Goal before deletion',
          );
        }
      });
      graph = await this.graphModel.getGraph(goalId);
      if (graph) {
        if (managed)
          await new GoalManagerService(this.db, this.userId, this.workspaceId).stop(graph);
        if (supervised)
          await new GoalSupervisorService(this.db, this.userId, this.workspaceId).stop(graph);
      }
    }
    const taskIds = graph?.nodes.flatMap((node) => (node.taskId ? [node.taskId] : [])) ?? [];

    for (const taskId of taskIds) {
      const topics = await this.taskTopicModel.findByTaskId(taskId);
      for (const topic of topics) {
        if (topic.status !== 'running' || !topic.topicId) continue;
        // Deliberately not swallowed. Interrupting can fail — the runtime or a
        // device gateway may be unreachable — and going ahead would delete the
        // only surface that can stop an operation which keeps spending. Better
        // to leave the goal intact and say so.
        try {
          await this.taskService.cancelTopic(topic.topicId);
        } catch (error) {
          throw new TRPCError({
            cause: error,
            code: 'PRECONDITION_FAILED',
            message:
              'Could not stop the work still running for this goal, so it was not deleted. Try again once the run is reachable.',
          });
        }
      }
      await this.taskModel
        .updateStatusIfCurrent(taskId, 'running', 'paused')
        .catch((error) => console.error('[GoalService.delete] failed to pause task:', error));
    }

    if (managed || supervised) {
      return this.db.transaction(async (db) => {
        const model = new GoalModel(db, this.userId, this.workspaceId);
        const current = await model.lockById(goalId);
        if (
          current &&
          (current.status !== 'paused' ||
            current.config?.managerState?.token !== graph?.goal.config?.managerState?.token ||
            current.config?.managerState?.turns !== graph?.goal.config?.managerState?.turns ||
            current.config?.supervisorState?.revision !==
              graph?.goal.config?.supervisorState?.revision)
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Goal changed during cancellation; it was not deleted',
          });
        }
        return model.delete(goalId);
      });
    }
    return this.goalModel.delete(goalId);
  };

  /**
   * Move the goal's lifecycle status and leave an event behind.
   *
   * The row update alone made status changes untraceable: `entityType='goal'`
   * events existed in the schema but nothing wrote them, so a goal's
   * planning → running → paused → achieved path could not be reconstructed
   * from its timeline. Transitions the coordinator makes are filed under the
   * coordinator actor; a person's pause/resume keeps the user attribution the
   * model defaults to — the split that separates what the coordinator decided
   * from what the user asked for relies on.
   *
   * A same-status write is a no-op — re-stamping `running` on every tick that
   * touches a running goal would flood the timeline the way the unbounded
   * event read flooded the payload.
   */
  private transitionStatus = async (
    goal: GoalItem,
    to: GoalStatus,
    reason?: string,
    actor: 'coordinator' | 'user' = 'coordinator',
  ): Promise<GoalItem | undefined> => {
    if (goal.status === to) return goal;
    const updated = await this.goalModel.updateStatus(goal.id, to);
    if (!updated) return undefined;
    const model = actor === 'coordinator' ? this.coordinatorGraph : this.graphModel;
    await model
      .recordGoalStatus(goal.id, goal.status, to, reason)
      .catch((error) => console.error('[GoalService] failed to record goal status:', error));
    return updated;
  };

  pause = async (goalId: string) => {
    const graph = await this.requireGraph(goalId);
    // From here the pause is the person's, so no later measurement lifts it.
    // Written even when the goal is already paused — that transition is a
    // no-op, so this marker is the only record that the person took it over.
    await this.setPauseReason(goalId, 'user');
    const goal = await this.transitionStatus(graph.goal, 'paused', 'paused by user', 'user');
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return goal;
  };

  /**
   * What the goal has spent against what it is allowed to spend.
   *
   * Rounds are counted across every Task in the graph, not per Task — the
   * budget is the goal's, so `setBudget` has to read it exactly the way the
   * coordinator does or raising a budget would not reliably unstick a goal.
   *
   * The calendar-time budget (schedule.deadline) is evaluated in the same
   * shape: time is the long-horizon budget unit the attempt/round/dollar trio
   * cannot express, and a goal whose deadline passed must stop the same way a
   * goal out of money does.
   */
  /**
   * Read every declared numeric clause against its series' latest observation.
   *
   * A missing series or a series with no points reads as `null` and fails its
   * clause: "never measured" is not "satisfied". The measured value is carried
   * out with the verdict so the trajectory records what the decision saw.
   */
  private evaluateMetricCriteria = async (
    graph: GoalGraphSnapshot,
  ): Promise<GoalMetricCriteriaState> => {
    const declared = graph.goal.config?.acceptance?.metrics ?? [];
    const metricModel = new MetricModel(this.db, this.userId, this.workspaceId);

    // Two queries for the whole contract, not two per clause: this runs on
    // every terminal tick, and a goal carrying a large acceptance payload would
    // otherwise pace the connection pool for unrelated requests. Only the
    // declared keys are fetched — the same goal can accumulate any number of
    // other sampled series, and none of them can gate acceptance.
    const series = await metricModel.findByKeys(
      'goal',
      graph.goal.id,
      declared.map((criterion) => criterion.key),
    );
    const seriesByKey = new Map(series.map((item) => [item.key, item]));
    const latestByMetricId = await metricModel.latestPointsByMetricIds(
      declared.flatMap((criterion) => {
        const id = seriesByKey.get(criterion.key)?.id;
        return id ? [id] : [];
      }),
    );

    const criteria = declared.map((criterion) => {
      const op = criterion.op ?? 'gte';
      const seriesId = seriesByKey.get(criterion.key)?.id;
      const point = seriesId ? latestByMetricId.get(seriesId) : undefined;
      const value = point?.value ?? null;
      return {
        key: criterion.key,
        met: value !== null && compareMetric(value, op, criterion.target),
        observedAt: point ? new Date(point.observedAt).getTime() : undefined,
        op,
        target: criterion.target,
        value,
      };
    });

    return { allMet: criteria.every((criterion) => criterion.met), criteria };
  };

  private evaluateBudget = async (goal: GoalItem, graph: GoalGraphSnapshot) => {
    const { runs, totalCost } = await this.resolveSpend(graph);
    const deadline = goal.config?.schedule?.deadline ?? null;
    return {
      costLimitReached: goal.maxTotalCost !== null && totalCost >= Number(goal.maxTotalCost),
      deadline,
      deadlinePassed: deadline !== null && Date.now() >= new Date(deadline).getTime(),
      roundLimitReached: goal.maxRounds !== null && runs >= goal.maxRounds,
      runs,
      totalCost,
    };
  };

  /**
   * Rounds run and dollars spent, by the definition the budget is enforced
   * against: the runs of the graph's own Task nodes.
   *
   * `graph()` ships this to the client so the page's spend reads the same
   * number the coordinator will stop on. Note it is deliberately NOT the goal
   * list's `totalRunCost`, which walks the whole `parent_task_id` subtree —
   * that number is larger for a goal whose Tasks spawned Tasks.
   */
  private resolveSpend = async (graph: GoalGraphSnapshot) => {
    const [spend, supervision, management] = await Promise.all([
      this.taskTopicModel.sumRunCostByTaskIds(
        graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : [])),
      ),
      new GoalSupervisorService(this.db, this.userId, this.workspaceId).usage(
        graph.goal.config?.supervisorState,
      ),
      new GoalManagerService(this.db, this.userId, this.workspaceId).usage(
        graph.goal.id,
        graph.goal.config?.managerState,
      ),
    ]);
    return {
      ...spend,
      totalCost: spend.totalCost + supervision.totalCost + management.totalCost,
      totalTokens: spend.totalTokens + supervision.totalTokens + management.totalTokens,
    };
  };

  /**
   * Edit the goal's standing acceptance requirement in place. The next
   * coordinator move and every later dispatched Task read the updated text;
   * an already-running Task keeps the contract it was dispatched with.
   */
  updateRequirement = async (goalId: string, requirement: string) => {
    const goal = await this.goalModel.update(goalId, { requirement });
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return goal;
  };

  /**
   * Hand the goal to a different agent. The goal agent supervises: it owns the
   * goal page and list entry and runs every planning turn. When it also does
   * the goal's own Tasks (no separate `taskAgentId`), every Task the
   * coordinator creates from here on goes to the new agent and — unless the
   * caller opts out — the unfinished ones move with it. A goal whose Tasks go
   * to a dedicated executor keeps them there; see `setTaskAgent`.
   *
   * The management conversation moves with supervision: it lives in the goal
   * agent's own history, so it is re-created for the new agent here instead of
   * being left pointing at the previous agent's topic until the next claim.
   */
  setAgent = async (
    goalId: string,
    agentId: string,
    options?: { goalOnly?: boolean },
  ): Promise<{ goal: GoalItem; reassignedTaskIds: string[] }> => {
    await assertAgentUsableBy(this.db, agentId, {
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    const goal = await this.goalModel.update(goalId, { agentId });
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

    // The receipt carries the management topic, so the caller must get the row
    // with the migrated one — not the copy read before the handoff.
    const migrated = await new GoalManagerService(
      this.db,
      this.userId,
      this.workspaceId,
    ).moveConversationTo(goalId, agentId);

    const reassignedTaskIds = await this.followGoalAgent(goal, agentId, options?.goalOnly);
    return {
      goal: migrated ? ((await this.goalModel.findById(goalId)) ?? goal) : goal,
      reassignedTaskIds,
    };
  };

  /**
   * After the goal agent changed: when that agent also does the goal's Tasks,
   * unfinished ones follow it unless the caller keeps them (`goalOnly`). A goal
   * with a dedicated executor keeps its Tasks there.
   */
  private followGoalAgent = async (
    goal: Pick<GoalItem, 'config' | 'id'>,
    agentId: string,
    goalOnly?: boolean,
  ) => (goalOnly || goal.config?.taskAgentId ? [] : this.reassignUnfinishedTasks(goal.id, agentId));

  /**
   * Route the goal's Tasks to a dedicated executor, or back to the goal agent
   * with `null`. The goal agent keeps supervising either way. Unfinished Tasks
   * move with the change unless the caller opts out.
   */
  setTaskAgent = async (
    goalId: string,
    agentId: string | null,
    options?: { goalOnly?: boolean },
  ): Promise<{ goal: GoalItem; reassignedTaskIds: string[] }> => {
    if (agentId) {
      await assertAgentUsableBy(this.db, agentId, {
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    }
    const current = await this.goalModel.findById(goalId);
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    // Naming the goal agent itself is the same as clearing: one agent, one slot.
    const goal = await this.goalModel.updateTaskAgentId(
      goalId,
      agentId && agentId !== current.agentId ? agentId : null,
    );
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

    const assignee = goalTaskAgentId(goal);
    const reassignedTaskIds =
      options?.goalOnly || !assignee ? [] : await this.reassignUnfinishedTasks(goalId, assignee);
    return { goal, reassignedTaskIds };
  };

  /**
   * The agent the next coordinator-created Task goes to.
   *
   * `taskAgentId` lives in JSON, so deleting the executor does not null it the
   * way the `agent_id` foreign key is nulled. Handing that stale id to
   * `createTask` fails with NOT_FOUND on every tick and the goal can never
   * create work again — so a missing executor falls back to the goal agent.
   */
  private resolveTaskAssignee = async (goal: GoalItem) => {
    const taskAgentId = goal.config?.taskAgentId;
    if (taskAgentId && !(await this.agentModel.existsById(taskAgentId)))
      return goal.agentId ?? undefined;
    return goalTaskAgentId(goal);
  };

  /**
   * Snapshot the graph AFTER the goal row moved: a task the coordinator binds
   * later inherits the new assignee from the goal, and a task bound before is in
   * this snapshot — so no concurrently created task can slip through the
   * handoff still pointing at the previous agent. A Task mid-run keeps its
   * current operation; `runTask` reads the assignee at its next dispatch.
   */
  private reassignUnfinishedTasks = async (goalId: string, agentId: string) => {
    const graph = await this.requireGraph(goalId);
    const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
    const reassigned: string[] = [];
    for (const task of await this.taskModel.findByIds(taskIds)) {
      if (task.status === 'completed' || task.status === 'canceled') continue;
      if (task.assigneeAgentId === agentId) continue;
      await this.taskModel.update(task.id, { assigneeAgentId: agentId });
      reassigned.push(task.id);
    }
    return reassigned;
  };

  /**
   * Start every unfinished Task node over: interrupt the run it may still be
   * holding, clear the failure it may be parked on, and return the Task to
   * `backlog` so the next coordinator tick dispatches it afresh. Optionally
   * hands the restarted Tasks to a different agent in the same gesture — the
   * goal's executor slot moves with them: `taskAgentId` when the goal routes
   * work to a dedicated executor, otherwise the goal agent that does its own
   * Tasks. Resolved nodes and their completed Tasks are left untouched.
   */
  restart = async (
    goalId: string,
    options?: { agentId?: string },
  ): Promise<{ goal: GoalItem; restartedTaskIds: string[] }> => {
    if (options?.agentId) {
      await assertAgentUsableBy(this.db, options.agentId, {
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    }
    const graph = await this.requireGraph(goalId);

    const unfinishedNodes = graph.nodes.filter(
      (node) =>
        node.kind === 'task' &&
        !isGoalReportNode(graph, node) &&
        node.taskId &&
        !TERMINAL_NODE_STATUSES.has(node.status),
    );
    const unfinishedNodeIds = new Set(unfinishedNodes.map((node) => node.id));
    const unfinishedTaskIds = unfinishedNodes.flatMap((node) => (node.taskId ? [node.taskId] : []));

    // A restarted task's pending failure gate is answered by the restart
    // itself. Left pending, it would keep winning the coordinator's
    // pending-decision branch and the goal would sit `waiting_human` with
    // every task freshly reset. Gates on untouched nodes keep parking the
    // goal — they ask something this restart does not answer.
    // Gate edges run task-node → decision-node (see openFailureDecision).
    const staleGates = graph.decisions.filter(
      (decision) =>
        decision.status === 'pending' &&
        graph.edges.some(
          (edge) =>
            edge.kind === 'leads_to' &&
            edge.targetNodeId === decision.nodeId &&
            unfinishedNodeIds.has(edge.sourceNodeId),
        ),
    );
    for (const gate of staleGates) {
      await this.graphModel.cancelDecision(goalId, gate.id, 'Superseded by goal restart');
    }

    const restartedTaskIds: string[] = [];
    if (unfinishedTaskIds.length > 0) {
      const runningTopics = await this.taskTopicModel.findRunningByTaskIds(unfinishedTaskIds);
      for (const topic of runningTopics) {
        if (topic.topicId) await this.taskService.cancelTopic(topic.topicId);
      }
      // Re-read after the cancels and reset via compare-and-swap: a coordinator
      // tick dispatching concurrently moves the row between our read and the
      // write, the CAS loses, and that task is skipped instead of yanked out
      // from under a freshly claimed run (which would double-dispatch it).
      for (const task of await this.taskModel.findByIds(unfinishedTaskIds)) {
        if (task.status === 'completed') continue;
        const reset = await this.taskModel.updateStatusIfCurrent(task.id, task.status, 'backlog', {
          error: null,
        });
        if (!reset) continue;
        if (options?.agentId) {
          await this.taskModel.update(task.id, { assigneeAgentId: options.agentId });
        }
        restartedTaskIds.push(task.id);
      }
    }

    // The handoff lands only after the interrupts succeeded — a cancelTopic
    // failure above must not leave the goal pointing at the new agent while
    // its tasks and live runs still belong to the old one.
    let goal = graph.goal;
    if (options?.agentId) {
      const updated = goal.config?.taskAgentId
        ? await this.goalModel.updateTaskAgentId(goalId, options.agentId)
        : await this.goalModel.update(goalId, { agentId: options.agentId });
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      goal = updated;
    }

    // A restart is an explicit "start over": a goal parked by a budget stop or
    // a manual pause must begin ticking again without a second gesture.
    if (goal.status === 'paused') {
      goal = (await this.resume(goalId)) ?? goal;
    }
    return { goal, restartedTaskIds };
  };

  /**
   * Task access under the goal owner's principal — the identity the goal's
   * coordinator creates and runs its Tasks as. Only for acting on Tasks already
   * bound to this goal's nodes, after the caller's right to manage the goal has
   * been checked.
   */
  private goalOwnerTaskScope = (goal: { userId: string }) =>
    goal.userId === this.userId
      ? {
          taskModel: this.taskModel,
          taskService: this.taskService,
          taskTopicModel: this.taskTopicModel,
        }
      : {
          taskModel: new TaskModel(this.db, goal.userId, this.workspaceId),
          taskService: new TaskService(this.db, goal.userId, this.workspaceId),
          taskTopicModel: new TaskTopicModel(this.db, goal.userId, this.workspaceId),
        };

  /**
   * Retire Task nodes a person no longer wants run — a duplicated plan branch,
   * work that landed elsewhere. Without this a stray node that never got a Task
   * stays unfinished forever and the coordinator can never reach acceptance.
   *
   * Nodes are retired as one set: any unfinished Task still depending on a node
   * in the set must be in the set too, otherwise it would wait on a
   * prerequisite that will never resolve.
   */
  retireNodes = async (
    goalId: string,
    nodeIds: string[],
    reason?: string,
  ): Promise<{ retiredNodeIds: string[] }> => {
    const graph = await this.requireGraph(goalId);
    const targetIds = new Set(nodeIds);

    const targets = [...targetIds].map((nodeId) => {
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) throw new TRPCError({ code: 'NOT_FOUND', message: `Node ${nodeId} not found` });
      if (node.kind !== 'task') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Node ${nodeId} is a ${node.kind}; only task nodes can be retired`,
        });
      }
      // An already-retired node is accepted so an interrupted retirement (its
      // fence landed, stopping the run did not) can be finished by retrying.
      if (node.status !== 'retired' && TERMINAL_NODE_STATUSES.has(node.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Node ${nodeId} is already ${node.status}`,
        });
      }
      // Retiring the terminal acceptance fails the whole Goal; that verdict
      // belongs to its decision gate, not to a graph edit.
      if (node.title === GOAL_ACCEPTANCE_TASK_TITLE) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The Goal acceptance task cannot be retired',
        });
      }
      return node;
    });

    const strandedIds = graph.edges
      .filter(
        (edge) =>
          edge.kind === 'depends_on' &&
          targetIds.has(edge.targetNodeId) &&
          !targetIds.has(edge.sourceNodeId),
      )
      .map((edge) => graph.nodes.find((node) => node.id === edge.sourceNodeId))
      .filter(
        (node): node is NonNullable<typeof node> =>
          !!node && node.kind === 'task' && !TERMINAL_NODE_STATUSES.has(node.status),
      )
      .map((node) => node.id);
    if (strandedIds.length > 0) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Unfinished tasks depend on these nodes; retire them together: ${[...new Set(strandedIds)].join(', ')}`,
      });
    }

    // Fence the nodes BEFORE looking for their Tasks. The snapshot above can
    // miss a Task a concurrent tick is creating for a proposed node; once the
    // node reads `retired`, `bindTask` (which only binds an `active` node) can
    // no longer attach that Task, and the creator discards it.
    for (const node of targets) {
      if (node.status === 'retired') continue;
      await this.graphModel.updateNodeStatus(goalId, node.id, 'retired', reason);
    }

    // Stop what the nodes are still running, so a retired node cannot keep
    // spending or deliver into the Goal afterwards. Bound Tasks are read after
    // the fence so a Task bound just before it is included.
    const fenced = await this.requireGraph(goalId);
    const taskIds = fenced.nodes.flatMap((node) =>
      targetIds.has(node.id) && node.taskId ? [node.taskId] : [],
    );
    if (taskIds.length > 0) {
      // The caller may be a workspace owner retiring a colleague's goal (the
      // router authorizes that). The nodes' Tasks were created by the goal's
      // coordinator, which runs as the goal's owner — and may be `private`,
      // inherited from that owner's private agent — so reads under the caller's
      // visibility would miss them and leave them running. Stop them under the
      // goal owner's principal instead, limited to the Tasks bound to the nodes
      // being retired.
      const { taskModel, taskService, taskTopicModel } = this.goalOwnerTaskScope(fenced.goal);
      const cancelTasks = async () => {
        for (const id of taskIds) {
          // CAS against the status just read; a runner flipping the Task to
          // `running` in between makes it miss, so re-read and try again.
          for (let attempt = 0; attempt < 3; attempt++) {
            const [task] = await taskModel.findByIds([id]);
            if (!task || ['canceled', 'completed', 'failed'].includes(task.status)) break;
            if (await taskModel.updateStatusIfCurrent(id, task.status, 'canceled')) break;
          }
        }
      };
      // Cancel the Tasks FIRST: that is the fence a run still being dispatched
      // checks under the Task's row lock before recording its operation, so a
      // run started from here on stops itself (TaskRunnerService.runTask).
      // Runs recorded before the fence are then found and stopped below.
      await cancelTasks();
      for (const topic of await taskTopicModel.findRunningByTaskIds(taskIds)) {
        if (topic.topicId) await taskService.cancelTopic(topic.topicId);
      }
      // `cancelTopic` parks its Task as `paused`; settle them back to canceled.
      await cancelTasks();
    }

    // A pending recovery gate on a retired node asks a question nobody needs
    // answered any more; left pending it keeps the Goal parked in review.
    for (const decision of fenced.decisions) {
      if (decision.status !== 'pending') continue;
      const gatedByTarget = fenced.edges.some(
        (edge) =>
          edge.kind === 'leads_to' &&
          edge.targetNodeId === decision.nodeId &&
          targetIds.has(edge.sourceNodeId),
      );
      if (gatedByTarget) {
        await this.graphModel.cancelDecision(goalId, decision.id, 'Superseded by node retirement');
      }
    }

    // Reopen a goal the coordinator parked because of what was just retired:
    // `review` held by the retired node's gate, or `paused` by `no_frontier`
    // (the stray branch left nothing runnable). A pause somebody chose — or
    // one the coordinator took for another reason, like a budget — is left.
    const after = await this.requireGraph(goalId);
    const lastTransition = after.events.find((event) => event.entityType === 'goal');
    const parkedOnNoFrontier =
      after.goal.status === 'paused' &&
      !after.goal.config?.pausedBy &&
      lastTransition?.actorType !== 'user' &&
      lastTransition?.reason === NO_FRONTIER_PAUSE_REASON;
    if (after.goal.status === 'review' || parkedOnNoFrontier) {
      const hasPendingDecision = after.decisions.some((decision) => decision.status === 'pending');
      if (!hasPendingDecision) {
        await this.transitionStatus(after.goal, 'running', 'nodes retired by user', 'user');
      } else if (parkedOnNoFrontier) {
        await this.transitionStatus(after.goal, 'review', 'nodes retired by user', 'user');
      }
    }

    return { retiredNodeIds: targets.map((node) => node.id) };
  };

  setBudget = async (
    goalId: string,
    budget: {
      deadline?: string | null;
      maxAttemptsPerTask?: number;
      maxConcurrentTasks?: number | null;
      maxExperiments?: number;
      maxManagerTurns?: number;
      maxRounds?: number | null;
      maxStepsPerRun?: number | null;
      maxTotalCost?: number | null;
    },
  ) => {
    const before = await this.requireGraph(goalId);
    const wasBinding = await this.evaluateBudget(before.goal, before);
    const managerTurnsWereSpent = managerTurnsSpent(before.goal.config);

    // Deadline joins the two execution budgets on the goal row's config; null
    // clears it, and omitting it leaves it alone — the cost/round editor sends
    // only what it owns, and must not silently drop a deadline someone set.
    // The merge keeps an untouched recovery/schedule block intact.
    const config = { ...before.goal.config };
    if (budget.maxExperiments !== undefined) {
      if (
        !config.exploration ||
        !Number.isInteger(budget.maxExperiments) ||
        budget.maxExperiments < 1 ||
        budget.maxExperiments > 200
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'An exploration Goal requires 1–200 experiments',
        });
      }
      config.exploration = { ...config.exploration, maxExperiments: budget.maxExperiments };
    }
    if (budget.deadline !== undefined) {
      config.schedule = { ...config.schedule, deadline: budget.deadline };
    }
    // The limits a goal is created with stay editable: a goal that ran into one
    // must be continued with a higher one, not replaced by a copy of itself.
    if (budget.maxManagerTurns !== undefined) {
      if (!config.manager) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only a Goal with a main Agent has a turn budget',
        });
      }
      config.manager = { ...config.manager, maxTurns: budget.maxManagerTurns };
    }
    if (budget.maxConcurrentTasks !== undefined) {
      config.maxConcurrentTasks = budget.maxConcurrentTasks;
    }
    if (budget.maxAttemptsPerTask !== undefined || budget.maxStepsPerRun !== undefined) {
      config.recovery = {
        ...config.recovery,
        ...(budget.maxAttemptsPerTask !== undefined && {
          maxAttemptsPerTask: budget.maxAttemptsPerTask,
        }),
        ...(budget.maxStepsPerRun !== undefined && { maxStepsPerRun: budget.maxStepsPerRun }),
      };
    }

    const goal = await this.goalModel.update(goalId, {
      config,
      maxRounds: budget.maxRounds,
      maxTotalCost: budget.maxTotalCost,
    });
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

    // Raising a budget is how a user un-sticks a goal the coordinator parked on
    // one, and `tick` refuses to move a paused goal — so without this the
    // queued advance would return straight away and the user would have to find
    // Resume as a second gesture. Only a goal the budget actually stopped is
    // reopened: if the old budget was not binding, this pause was somebody's
    // deliberate one and is left alone.
    const stoppedByBudget =
      wasBinding.costLimitReached || wasBinding.roundLimitReached || wasBinding.deadlinePassed;
    const stoppedByExploration = before.goal.config?.pausedBy === 'exploration_limit';
    // The main Agent pauses its goal when its turns run out, and resuming alone
    // pauses it again on the next tick. Raising the cap is what lets it continue.
    const stoppedByManagerTurns = managerTurnsWereSpent && !managerTurnsSpent(goal.config);
    if (
      goal.status !== 'paused' ||
      goal.config?.pausedBy === 'user' ||
      (!stoppedByBudget && !stoppedByExploration && !stoppedByManagerTurns)
    )
      return goal;
    if (
      stoppedByExploration &&
      before.nodes.filter(
        (node) =>
          node.kind === 'task' &&
          node.title !== GOAL_ACCEPTANCE_TASK_TITLE &&
          !isGoalReportNode(before, node),
      ).length >= (goal.config?.exploration?.maxExperiments ?? 0)
    )
      return goal;

    const nowBinding = await this.evaluateBudget(goal, before);
    if (nowBinding.costLimitReached || nowBinding.roundLimitReached || nowBinding.deadlinePassed) {
      return goal;
    }

    return (await this.resume(goalId)) ?? goal;
  };

  resume = async (goalId: string) => {
    const graph = await this.requireGraph(goalId);
    const status = graph.decisions.some((decision) => decision.status === 'pending')
      ? 'review'
      : 'running';
    // Compare-and-set under the row lock `close` commits under: a resume that
    // read the goal before a concurrent close ended it must not write its stale
    // `running` over the ended goal, where the close already put interrupted
    // Tasks back to `backlog` and they would dispatch again. Reopening an ended
    // goal still works — that resume reads the ended status itself.
    return this.db.transaction(async (tx) => {
      const model = new GoalModel(tx, this.userId, this.workspaceId);
      const current = await model.lockById(goalId);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      if (current.status !== graph.goal.status) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The goal changed while it was being resumed; try again.',
        });
      }
      await model.updatePauseReason(goalId, undefined);
      if (current.status === status) return current;
      const updated = await model.updateStatus(goalId, status);
      await new GoalGraphModel(tx, this.userId, this.workspaceId)
        .recordGoalStatus(goalId, current.status, status, 'resumed by user')
        .catch((error) => console.error('[GoalService] failed to record goal status:', error));
      return updated ?? current;
    });
  };

  /**
   * A person ends the goal themselves — declaring it achieved or dropping it.
   *
   * Everything still spending on the goal is interrupted first — the main
   * Agent's planning turn, the supervisor's diagnosis and every Task run — the
   * same way `delete` does, because a terminal status alone only stops the
   * coordinator from dispatching more. Reopening goes through `resume`, which
   * accepts any status.
   */
  close = async (goalId: string, to: 'achieved' | 'canceled') => {
    // Fence new claims before scanning: `dispatchWork` claims under this row
    // lock and only while the goal reads `running`, so an advance overlapping
    // the close cannot start a Task after the scan below. The pause is the
    // person's, so no measurement lifts it if the close is refused later on.
    await this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const current = await model.lockById(goalId);
      // Only a goal that can still dispatch needs fencing.
      if (!current || ['paused', 'achieved', 'failed', 'canceled'].includes(current.status)) return;
      await model.updateStatus(goalId, 'paused');
      await model.updatePauseReason(goalId, 'user');
      await new GoalGraphModel(db, this.userId, this.workspaceId).recordGoalStatus(
        goalId,
        current.status,
        'paused',
        'Stopping Goal before closing',
      );
    });
    const graph = await this.requireGraph(goalId);

    // Deliberately not swallowed, as in `delete`: an operation whose exit is
    // unconfirmed keeps spending, and a goal reading "ended" would hide it. The
    // goal stays paused so nothing new starts, and the person can retry.
    const notClosed = (error: unknown) =>
      new TRPCError({
        cause: error,
        code: 'PRECONDITION_FAILED',
        message:
          'Could not stop the work still running for this goal, so it was not closed. Try again once the run is reachable.',
      });
    try {
      if (graph.goal.config?.manager)
        await new GoalManagerService(this.db, this.userId, this.workspaceId).stop(graph);
      if (graph.goal.config?.supervision?.enabled || graph.goal.config?.supervisorState)
        await new GoalSupervisorService(this.db, this.userId, this.workspaceId).stop(graph);
    } catch (error) {
      throw notClosed(error);
    }

    const unfinishedTaskIds = graph.nodes.flatMap((node) =>
      node.kind === 'task' && node.taskId && !TERMINAL_NODE_STATUSES.has(node.status)
        ? [node.taskId]
        : [],
    );
    if (unfinishedTaskIds.length > 0) {
      // Claims whose run has not been recorded yet. `dispatchWork` marks the
      // Task `running` before `runTask` records the topic, so the scan below
      // cannot see that run, and only a recorded run can be interrupted with
      // confirmation. A fresh claim therefore refuses the close: the goal stays
      // fenced, and a retry a moment later finds the run recorded and stops it
      // the confirmed way. A claim older than the operation lease is one whose
      // startup died; it is withdrawn to `backlog` under the task row lock the
      // recording also takes, so a straggler recording stops its own run.
      const staleBefore = Date.now() - resolveOperationLeaseTimeout(graph.goal);
      let starting = false;
      for (const taskId of unfinishedTaskIds) {
        await this.db.transaction(async (tx) => {
          const taskModel = new TaskModel(tx, this.userId, this.workspaceId);
          if (!(await taskModel.lockForUpdate(taskId))) return;
          const task = await taskModel.findById(taskId);
          if (task?.status !== 'running') return;
          const recorded = await new TaskTopicModel(
            tx,
            this.userId,
            this.workspaceId,
          ).findRunningByTaskIds([taskId]);
          if (recorded.length > 0) return;
          if (task.updatedAt.getTime() > staleBefore) {
            starting = true;
            return;
          }
          await taskModel.updateStatusIfCurrent(taskId, 'running', 'backlog', { error: null });
        });
      }
      if (starting)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'A run for this goal is still starting, so it was not closed. No new work will start; try again in a moment.',
        });

      const runningTopics = await this.taskTopicModel.findRunningByTaskIds(unfinishedTaskIds);
      for (const topic of runningTopics) {
        if (!topic.topicId) continue;
        try {
          await this.taskService.cancelTopic(topic.topicId);
        } catch (error) {
          throw notClosed(error);
        }
        // Reset right after its own interruption, as in `restart`: left `paused`
        // it reads as parked on a person and a reopened goal waits on it. Doing
        // it per run means a later failed interruption cannot strand the ones
        // already stopped — a retry no longer sees them as running. CAS so a
        // row a concurrent tick just moved is never yanked.
        const task = await this.taskModel.findById(topic.taskId);
        if (task && task.status !== 'completed') {
          await this.taskModel.updateStatusIfCurrent(task.id, task.status, 'backlog', {
            error: null,
          });
        }
      }
    }
    // Commit under the same lock the fence took, and only if the fence still
    // holds: a resume from another tab during the interruption pass lets an
    // advance claim work this pass never saw, and ending the goal over it
    // would leave that run spending on a goal reading "ended".
    const reason = to === 'achieved' ? 'marked achieved by user' : 'canceled by user';
    const goal = await this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const current = await model.lockById(goalId);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      if (!['paused', 'achieved', 'failed', 'canceled'].includes(current.status)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The goal was resumed while it was being closed, so it was not closed.',
        });
      }
      await model.updatePauseReason(goalId, undefined);
      if (current.status === to) return current;
      const updated = await model.updateStatus(goalId, to);
      await new GoalGraphModel(db, this.userId, this.workspaceId)
        .recordGoalStatus(goalId, current.status, to, reason)
        .catch((error) => console.error('[GoalService] failed to record goal status:', error));
      return updated;
    });
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return goal;
  };

  decide = async (goalId: string, decisionId: string, optionId: string, resolution?: string) => {
    const graph = await this.requireGraph(goalId);
    // A goal a person ended stays ended: a gate another tab still shows must
    // not reopen it. Checked again under the lock before the status moves.
    if (GOAL_ENDED_STATUSES.has(graph.goal.status)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'This goal has ended' });
    }
    const decision = graph.decisions.find((item) => item.id === decisionId);
    if (!decision || decision.status !== 'pending') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Pending decision not found' });
    }
    if (decision.options?.length && !decision.options.some((option) => option.id === optionId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown decision option' });
    }
    // The note *is* the answer for this option; an empty one would re-plan the
    // goal on nothing and the question could never be asked again.
    if (optionId === GOAL_CLARIFICATION_OPTION.answer && !resolution?.trim()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This answer needs a note' });
    }
    const chosen = decision.options?.find((option) => option.id === optionId);
    const resolved = await this.graphModel.resolveDecision(
      goalId,
      decisionId,
      optionId,
      resolution,
    );
    if (!resolved)
      throw new TRPCError({ code: 'CONFLICT', message: 'Decision was already resolved' });

    const incoming = graph.edges.find(
      (edge) => edge.targetNodeId === decision.nodeId && edge.kind === 'leads_to',
    );
    const source = incoming && graph.nodes.find((node) => node.id === incoming.sourceNodeId);
    if (source?.kind === 'task') {
      if (source.taskId)
        await new GoalSupervisorService(this.db, this.userId, this.workspaceId).recordProgress(
          graph,
          source.taskId,
          true,
        );
      const effect = decisionOptionEffect(chosen, source.title);
      if (effect === 'retry' && source.taskId) {
        await this.taskModel.updateStatus(source.taskId, 'backlog', { error: null });
        await this.graphModel.updateNodeStatus(goalId, source.id, 'active', resolution);
        // The note is guidance for the next attempt, so it goes where that
        // attempt reads: the Task's comments are part of every run prompt.
        // On the node status alone it was recorded and never read again.
        const guidance = decisionGuidance(decision.question, chosen, resolution);
        if (guidance)
          await this.taskModel.addComment({
            authorUserId: this.userId,
            content: guidance,
            taskId: source.taskId,
            userId: this.userId,
          });
      } else if (effect === 'retire') {
        await this.graphModel.updateNodeStatus(goalId, source.id, 'retired', resolution);
      }
    }
    // R5: a person answering a batch gate IS the intervention, and an
    // intervention rolls the class back to canary. Open the next recipe round
    // automatically — revise the same mould, or fork it as a new class — rather
    // than leaving the goal parked for someone to rerun by hand.
    const rolloutState = graph.goal.config?.rolloutState;
    if (rolloutState?.phase === 'pattern_break' && decision.nodeId === rolloutState.assayNodeId) {
      await this.restartRolloutLoop(goalId, decision, optionId, resolution, chosen);
    }
    // Ending the terminal acceptance ends the Goal: `fail` is a verdict that
    // the Goal failed, `retire` abandons it without one.
    const terminalAcceptance = source?.title === GOAL_ACCEPTANCE_TASK_TITLE;
    const terminalEffect = decisionOptionEffect(chosen, source?.title);
    const nextStatus =
      terminalAcceptance && terminalEffect === 'fail'
        ? 'failed'
        : terminalAcceptance && terminalEffect === 'retire'
          ? 'canceled'
          : 'running';
    // Serialized with `close`, which commits under this row lock: a goal that
    // ended while this answer was being written is left ended.
    await this.db.transaction(async (tx) => {
      const current = await new GoalModel(tx, this.userId, this.workspaceId).lockById(goalId);
      if (!current || GOAL_ENDED_STATUSES.has(current.status)) return;
      if (current.status === nextStatus) return;
      await new GoalModel(tx, this.userId, this.workspaceId).updateStatus(goalId, nextStatus);
      await new GoalGraphModel(tx, this.userId, this.workspaceId, {
        id: GOAL_COORDINATOR_ACTOR_ID,
        type: 'system',
      })
        .recordGoalStatus(
          goalId,
          current.status,
          nextStatus,
          `decision "${decision.question}" resolved: ${optionId}`,
        )
        .catch((error) => console.error('[GoalService] failed to record goal status:', error));
    });
    return resolved;
  };

  /**
   * The owner sent the Goal's delivery back (提出修改 on the Goal-level
   * acceptance). The acceptance passing is what ended the Goal, so without a
   * reopen the coordinator reads it as still achieved and nothing reworks it.
   * The acceptance Task goes back to the queue — its next attempt reads the
   * rejected round's comment through the prompt builder — and the Goal runs
   * again. When that attempt is accepted the Goal is achieved anew, and the
   * wrap-up writes a new report version for the new result.
   *
   * Returns the reopened Goal id, or undefined when `taskId` is not a settled
   * Goal-level acceptance of a Goal that can still be reworked; a stopped Goal
   * is continued from its result, not reopened by a sign-off.
   */
  reopenForChanges = async (taskId: string, comment?: string): Promise<string | undefined> => {
    const goal = await this.goalModel.findByGraphTask(taskId);
    if (!goal || !REOPENABLE_GOAL_STATUSES.has(goal.status)) return undefined;
    const graph = await this.requireGraph(goal.id);
    const node = graph.nodes.find(
      (candidate) =>
        candidate.kind === 'task' &&
        candidate.taskId === taskId &&
        candidate.title === GOAL_ACCEPTANCE_TASK_TITLE,
    );
    if (node?.status !== 'resolved') return undefined;

    const reason = comment ? `Changes requested: ${comment}` : 'Changes requested';
    await this.taskModel.updateStatus(taskId, 'backlog', { error: null });
    await this.graphModel.updateNodeStatus(goal.id, node.id, 'active', reason);
    await this.goalModel.update(goal.id, {
      config: {
        ...graph.goal.config,
        changeRequest: {
          ...(comment ? { comment } : {}),
          requestedAt: new Date().toISOString(),
          taskId,
        },
      },
    });
    await this.transitionStatus(graph.goal, 'running', reason, 'user');
    return goal.id;
  };

  /**
   * Answer a goal's clarification round in one go. Each answer resolves like a
   * single `decide`; the caller schedules one advance afterwards, so the
   * re-plan sees every answer instead of running after the first.
   */
  answerClarifications = async (
    goalId: string,
    answers: Array<{ decisionId: string; optionId: string; resolution?: string }>,
  ) => {
    const graph = await this.requireGraph(goalId);
    const decisions = new Map(graph.decisions.map((decision) => [decision.id, decision]));

    // Check the whole round before writing any of it: one bad answer used to
    // leave the ones before it resolved, and the client's retry then failed on
    // those. An answer already recorded as given is a retry, not a conflict.
    const toResolve = answers.filter((answer) => {
      const decision = decisions.get(answer.decisionId);
      if (!decision) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Pending decision not found' });
      }
      if (decision.status === 'resolved' && decision.resolvedOptionId === answer.optionId) {
        return false;
      }
      if (decision.status !== 'pending') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Decision was already resolved' });
      }
      if (decision.options?.length && !decision.options.some((o) => o.id === answer.optionId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown decision option' });
      }
      if (answer.optionId === GOAL_CLARIFICATION_OPTION.answer && !answer.resolution?.trim()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This answer needs a note' });
      }
      return true;
    });

    for (const answer of toResolve) {
      await this.decide(goalId, answer.decisionId, answer.optionId, answer.resolution);
    }
  };

  /**
   * Everything the approval island asks outside a goal's page: the gates
   * waiting on the person (clarification rounds have their own form) and the
   * finished goals waiting for their sign-off.
   */
  pendingForIsland = async () => {
    const [decisions, signOffs] = await Promise.all([
      this.goalModel.listPendingDecisions(),
      this.briefs.listOpenSignOffs(),
    ]);
    return {
      decisions: decisions.map((row) => ({ ...row, options: row.options ?? [] })),
      signOffs,
    };
  };

  /** Pending clarifications grouped by goal, for surfaces outside the goal page. */
  pendingClarifications = async () => {
    const rows = await this.goalModel.listPendingClarifications();
    const byGoal = new Map<
      string,
      {
        agentId: string | null;
        goalId: string;
        questions: Array<{
          decisionId: string;
          description: string | null;
          options: GoalDecisionOption[];
          question: string;
        }>;
        requirement: string | null;
        title: string;
      }
    >();
    for (const row of rows) {
      const group = byGoal.get(row.goalId) ?? {
        agentId: row.agentId,
        goalId: row.goalId,
        questions: [],
        requirement: row.requirement,
        title: row.goalTitle,
      };
      group.questions.push({
        decisionId: row.decisionId,
        description: row.description,
        options: row.options ?? [],
        question: row.question,
      });
      byGoal.set(row.goalId, group);
    }
    return [...byGoal.values()];
  };

  /**
   * Advance the goal by one coordinator step.
   *
   * Choosing and doing are separate: `decideNextMove` is a pure function of the
   * graph, the responsible task and the budget, and everything under the switch
   * only carries that choice out. `onDecision` then receives both what the
   * coordinator read and what it did — the decision surface a goal trajectory
   * records. It travels on that side channel rather than on `GoalTickResult`
   * because the result crosses tRPC to the client and the graph payload is
   * large, the same reason the context engine snapshot stays off the agent
   * runtime's event array.
   */
  tick = async (goalId: string, options?: GoalTickOptions): Promise<GoalTickResult> => {
    const result = await this.tickOnce(goalId, options);
    if (REPORT_CHECK_OUTCOMES.has(result.outcome)) await this.dispatchGoalReport(goalId);
    return result;
  };

  /**
   * The wrap-up branch. Runs after the move rather than as one: it only fires
   * once the Goal-level acceptance has ended, and whatever happens to it — a
   * dispatch that throws, a run that fails or times out — must not change the
   * outcome the coordinator just reported or the Goal's status.
   */
  private dispatchGoalReport = async (goalId: string) => {
    try {
      await new GoalReportService(this.db, this.userId, this.workspaceId).dispatchIfDue(goalId);
    } catch (error) {
      console.error('[GoalService] wrap-up report dispatch failed:', error);
    }
  };

  private tickOnce = async (goalId: string, options?: GoalTickOptions): Promise<GoalTickResult> => {
    const at = Date.now();
    // The coordinator never sees the wrap-up report node: it runs after the
    // Goal-level acceptance and does not take part in the Goal's status.
    const graph = withoutGoalReport(await this.requireGraph(goalId));
    if (graph.goal.config?.manager) {
      // The system's own planner leads whenever the Goal has one: a main Agent is
      // the fallback for problems that planner cannot express, not a replacement
      // for it. With exploration configured this call only settles a turn already
      // in flight; new turns start from `gateOrTakeOver` below, where the
      // coordinator has run out of moves. A Goal whose only planner is the main
      // Agent keeps being led by it.
      const result = await new GoalManagerService(this.db, this.userId, this.workspaceId).advance(
        graph,
        { mayStartTurn: !graph.goal.config.exploration },
      );
      if (result) return result;
    }
    const frontier = selectFrontier(graph);

    // Every candidate's task, not just the head's: the scheduler has to know
    // which of them are in flight before it can decide what else to start.
    const candidateTaskIds = frontier.eligible.flatMap(({ node }) =>
      node.taskId ? [node.taskId] : [],
    );
    const tasksById = new Map(
      (candidateTaskIds.length > 0 ? await this.taskModel.findByIds(candidateTaskIds) : []).map(
        (task) => [task.id, task],
      ),
    );

    // Asked of every unblocked candidate, not just the head: the scheduler
    // walks past a running head to start an independent task, so a head that
    // needs no budget must not decide that nothing does. A goal with nothing
    // startable still skips the query.
    const budget = frontierNeedsBudget(frontier, tasksById)
      ? toBudgetState(graph.goal, await this.evaluateBudget(graph.goal, graph))
      : undefined;

    // Same shape as the budget: a database read the pure decision cannot do,
    // taken only in the terminal phase of a goal that declares numeric clauses.
    const metricCriteria = needsMetricCriteria(graph)
      ? await this.evaluateMetricCriteria(graph)
      : undefined;

    const concurrency = resolveMaxConcurrentTasks(graph.goal);
    // A repeated batch judges its own gate once the wave it released has fully
    // settled; while a wave is still running the ordinary frontier owns the tick.
    const rolloutGate = this.collectRolloutGate(graph);
    const move = decideNextMove({
      budget,
      concurrency,
      frontier,
      graph,
      metricCriteria,
      rolloutGate,
      tasksById,
    });
    // The scheduler may pick past the head of the frontier, so every arm below
    // acts on the node the move chose, which is not necessarily the
    // highest-ranked candidate.
    const acting = move.chosenNodeId
      ? graph.nodes.find((node) => node.id === move.chosenNodeId)
      : undefined;
    const actingTask = acting?.taskId ? (tasksById.get(acting.taskId) ?? null) : undefined;

    const effects: GoalAdvanceEffect[] = [];

    const observe = (result: GoalTickResult): GoalTickResult => {
      options?.onDecision?.({
        at,
        branch: move.branch,
        budget,
        candidates: move.candidates,
        metricCriteria,
        chosenNodeId: move.chosenNodeId,
        effects,
        candidateTasks: frontier.eligible.flatMap(({ node }) => {
          const task = node.taskId ? tasksById.get(node.taskId) : undefined;
          return task ? [toFrontierTaskState(task, node.id)] : [];
        }),
        concurrency,
        graphState: toTraceGraphState(graph),
        message: result.message,
        outcome: result.outcome,
        taskId: result.taskId,
      });
      return result;
    };

    switch (move.branch) {
      case 'goal_paused':
      case 'goal_terminal': {
        return observe({ goalId, message: move.message, outcome: move.outcome });
      }

      case 'pending_decision': {
        await this.transitionStatus(graph.goal, 'review', 'a decision gate is open');
        effects.push({ type: 'goal_status', detail: 'review' });
        return observe({
          goalId,
          message: move.message,
          nodeId: move.focusNodeId,
          outcome: move.outcome,
        });
      }

      // Managed Goals reconsider the same contract after a shortfall. Unmanaged
      // Goals park until an observation clears the gate, keeping them out of
      // the sweep while they have no action to take.
      case 'measured_acceptance': {
        const replanning = await new GoalManagerService(
          this.db,
          this.userId,
          this.workspaceId,
        ).reconsiderAcceptance(graph, move.message);
        if (replanning) return observe(replanning);
        await this.setPauseReason(goalId, 'measured_acceptance');
        await this.transitionStatus(graph.goal, 'paused', move.message);
        effects.push({ type: 'goal_status', detail: 'paused' });
        return observe({ goalId, message: move.message, outcome: move.outcome });
      }

      case 'terminal_acceptance': {
        return observe(await this.settleTerminalAcceptance(graph, move, effects));
      }

      case 'explore_graph': {
        const spent = await this.evaluateBudget(graph.goal, graph);
        if (spent.costLimitReached || spent.roundLimitReached || spent.deadlinePassed) {
          await this.transitionStatus(
            graph.goal,
            'paused',
            'Budget exhausted before graph exploration',
          );
          effects.push({ type: 'goal_status', detail: 'paused: budget' });
          return observe({
            goalId,
            outcome: 'no_progress',
            message: 'Budget exhausted before graph exploration',
          });
        }
        return observe(
          await exploreGraph({
            db: this.db,
            userId: this.userId,
            workspaceId: this.workspaceId,
            graph,
            effects,
          }),
        );
      }

      case 'plan_decomposition': {
        return observe(await this.planDecomposition(graph, effects));
      }

      case 'rollout_gate': {
        return observe(await this.releaseRolloutWave(graph, effects));
      }

      case 'pattern_break': {
        return observe(await this.openPatternBreakGate(graph, move.message, effects));
      }

      case 'no_frontier': {
        // Say so on the row instead of leaving a goal that reads as `running`
        // while it cannot run — and, just as importantly, take it out of the
        // sweep's window. A `running` goal that always reports `no_progress` is
        // picked by every scan forever, and enough of them starve every other
        // stalled goal out of the newest-first limit.
        await this.transitionStatus(graph.goal, 'paused', NO_FRONTIER_PAUSE_REASON);
        effects.push({ type: 'goal_status', detail: 'paused' });
        return observe({ goalId, message: move.message, outcome: move.outcome });
      }

      case 'create_task': {
        return observe(await this.createResponsibleTask(graph, acting!, effects));
      }

      case 'missing_task': {
        await this.coordinatorGraph.updateNodeStatus(
          goalId,
          acting!.id,
          'waiting',
          'Responsible task is missing',
        );
        effects.push({ nodeId: acting!.id, type: 'node_status', detail: 'waiting' });
        return observe({
          goalId,
          message: move.message,
          nodeId: acting!.id,
          outcome: move.outcome,
        });
      }

      default: {
        // Everything from here on has a live responsible task.
        const task = actingTask!;
        await this.ensureTaskWorkVersion(graph.goal.id, acting!.id, task.id);

        switch (move.branch) {
          case 'consume_completed': {
            return observe(await this.consumeCompletedTask(graph, acting!.id, task.id, effects));
          }

          case 'recover_lease': {
            return observe(await this.recoverLostRun(graph, acting!.id, task, effects));
          }

          case 'recover_verification': {
            return observe(await this.recoverAfterVerification(graph, acting!.id, task, effects));
          }

          case 'failure_decision': {
            const waiting =
              (await this.waitForDevice(graph, acting!.id, task, effects)) ??
              (await this.waitForQuotaReset(graph, acting!.id, task, effects));
            if (waiting) return observe(waiting);
            const held = await this.holdForMachineFailure(graph, acting!.id, task, effects);
            if (held) return observe(held);
            const supervision = await new GoalSupervisorService(
              this.db,
              this.userId,
              this.workspaceId,
            ).reviewFailure(graph, acting!.id, task);
            if (supervision) return observe(supervision);
            // A machine failure the supervisor gave up on still asks for a fix,
            // not a judgment about the work.
            return observe(
              await this.gateOrTakeOver(graph, acting!.id, task.id, move.message, effects, {
                machine: isMachineFailureClass(classifyGoalFailure(task.error).class),
              }),
            );
          }

          case 'task_paused': {
            return observe({
              goalId,
              message: move.message,
              nodeId: acting!.id,
              outcome: move.outcome,
              taskId: task.id,
            });
          }

          case 'task_running': {
            if (task.status === 'running') {
              const recovered = await this.recoverAbandonedTask(graph, acting!.id, task, effects);
              if (recovered) return observe(recovered);
            }
            return observe({
              goalId,
              message: move.message,
              nodeId: acting!.id,
              outcome: move.outcome,
              taskId: task.id,
            });
          }

          case 'budget_exhausted': {
            await this.transitionStatus(graph.goal, 'paused', move.message);
            effects.push({ type: 'goal_status', detail: 'paused' });
            return observe({
              goalId,
              message: move.message,
              nodeId: acting!.id,
              outcome: move.outcome,
              taskId: task.id,
            });
          }

          default: {
            return observe(await this.dispatchWork(graph, acting!.id, task, effects));
          }
        }
      }
    }
  };

  /**
   * Create the Goal-level acceptance Task, or read the verdict it already
   * reached. Only runs once every other Task is terminal.
   */
  private settleTerminalAcceptance = async (
    graph: GoalGraphSnapshot,
    move: GoalMove,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;

    if (move.outcome === 'achieved') {
      // The map must agree with the verdict: only task nodes get resolved as
      // Tasks complete, so without this the seeded problem nodes would read
      // "active / unanswered" forever on an achieved goal.
      for (const node of graph.nodes) {
        if (node.kind !== 'problem' || TERMINAL_NODE_STATUSES.has(node.status)) continue;
        await this.coordinatorGraph.updateNodeStatus(goalId, node.id, 'resolved', 'Goal achieved');
        effects.push({ detail: 'resolved', nodeId: node.id, type: 'node_status' });
      }
      // Ask for the sign-off before the goal turns terminal: nothing ticks an
      // achieved goal again, so a failed write after the transition would lose
      // the ask for good. Failing here leaves the goal open for the next tick,
      // and the write is idempotent per acceptance.
      await this.requestSignOff(graph);
      await this.transitionStatus(graph.goal, 'achieved', 'Goal-level acceptance passed');
      effects.push({ type: 'goal_status', detail: 'achieved' });
      return { goalId, message: move.message, outcome: 'achieved' };
    }

    if (move.outcome === 'no_progress') {
      return { goalId, message: move.message, nodeId: move.focusNodeId, outcome: 'no_progress' };
    }

    // The node and its links commit together. Once the node exists no later tick
    // comes back to link it, so writing them in separate transactions let an
    // interruption in between leave the acceptance detached from the work it
    // closes for good. Rolling the node back instead lets the next tick retry.
    const result = await this.db.transaction(async (tx) => {
      const writer = new GoalGraphModel(tx, this.userId, this.workspaceId, {
        id: GOAL_COORDINATOR_ACTOR_ID,
        type: 'system',
      });
      const created = await writer.createNodeOnce(goalId, {
        description: [
          `Complete and prove the overall Goal acceptance requirement: ${graph.goal.requirement}`,
          'Inspect and reuse existing Goal findings, artifacts, metrics, and command results as the primary evidence. Do not repeat expensive or destructive work when the existing evidence is sufficient and still auditable.',
          'Explicitly close every remaining acceptance gap instead of treating completed upstream Tasks as proof that the whole Goal is achieved. Run only the missing or stale checks needed to close those gaps.',
          'Return one auditable final delivery with evidence for every requirement. If a requirement cannot be satisfied, state the exact gap and the minimum next action; do not claim the Goal is complete.',
          graph.goal.config?.manager &&
          graph.goal.config.managerState?.submitted?.action === 'verify'
            ? `Main Agent verification handoff (context only, not acceptance criteria):\n${graph.goal.config.managerState.submitted.reason}\nIndependently check these notes against the evidence. They do not amend the authoritative Goal requirement or establish that it passed.`
            : undefined,
        ]
          .filter(Boolean)
          .join('\n\n'),
        kind: 'task',
        priority: -1,
        title: GOAL_ACCEPTANCE_TASK_TITLE,
      });
      if (!created?.created) return created;

      const problem = graph.nodes.find((node) => node.kind === 'problem');
      if (problem) {
        await writer.createEdge(goalId, problem.id, created.node.id, 'decomposes');
      }
      // Acceptance closes the whole Goal, so it builds on the work that ends each
      // line of the graph. Linking the delivered leaf Tasks lays it out below them
      // instead of beside the first round. They are all resolved, so nothing blocks.
      const delivered = graph.nodes.filter(
        (node) =>
          node.kind === 'task' &&
          node.status === 'resolved' &&
          node.id !== created.node.id &&
          !experimentOwner(graph, node.id),
      );
      const deliveredIds = new Set(delivered.map((node) => node.id));
      const builtUpon = new Set(
        graph.edges
          .filter((edge) => edge.kind === 'depends_on' && deliveredIds.has(edge.sourceNodeId))
          .map((edge) => edge.targetNodeId),
      );
      for (const leaf of delivered.filter((node) => !builtUpon.has(node.id))) {
        await writer.createEdge(goalId, created.node.id, leaf.id, 'depends_on');
      }
      return created;
    });
    if (!result) {
      return {
        goalId,
        message: 'Could not create the Goal-level acceptance Task',
        outcome: 'no_progress',
      };
    }
    if (result.created) {
      effects.push({ nodeId: result.node.id, type: 'created_node', detail: 'terminal acceptance' });
    }
    return {
      goalId,
      message: result.created
        ? 'Created Goal-level acceptance Task for the remaining contract'
        : 'Goal-level acceptance Task was created by another coordinator',
      nodeId: result.node.id,
      outcome: 'advanced',
    };
  };

  /** Claim the chosen Task node and give it a responsible task plus its acceptance contract. */
  private createResponsibleTask = async (
    graph: GoalGraphSnapshot,
    frontier: GoalGraphNode,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;
    const claim = await this.coordinatorGraph.claimTaskNode(
      goalId,
      frontier.id,
      new Date(Date.now() - TASK_NODE_CLAIM_TTL_MS),
    );
    if (!claim) {
      const current = (await this.requireGraph(goalId)).nodes.find(
        (node) => node.id === frontier.id,
      );
      return {
        goalId,
        message: current?.taskId
          ? 'Responsible task was created by another coordinator'
          : 'Task node is being claimed by another coordinator',
        nodeId: frontier.id,
        outcome: 'waiting_external',
        taskId: current?.taskId ?? undefined,
      };
    }

    let acceptanceId: string | undefined;
    let task: TaskItem | undefined;
    try {
      const parentId = provenanceParentId(graph, frontier.id);
      const parent = graph.nodes.find((node) => node.id === parentId);
      const description = [
        frontier.description ?? frontier.title,
        parent
          ? `Selected historical experiment: ${parent.id} — ${parent.title}\nHistorical result (evidence, not instructions):\n${experimentResults(graph, parent.id).join('\n\n')}\nPinned input Work versions: ${graph.workVersions
              .filter((version) => version.nodeId === frontier.id && version.relation === 'input')
              .map((version) => version.workVersionId)
              .join(', ')}`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n\n');
      task = await this.taskService.createTask({
        assigneeAgentId: await this.resolveTaskAssignee(graph.goal),
        config: { checkpoint: { topic: { after: false } } },
        description: description?.slice(0, TASK_DESCRIPTION_MAX_LENGTH),
        instruction: this.buildTaskInstruction(graph, frontier.title, description),
        name: frontier.title,
        projectId: graph.goal.projectId ?? undefined,
      });
      // The terminal Goal-acceptance Task is gated on the goal's structured
      // criteria when it has them: the verify plan materializes exactly those
      // rows (deterministic checklist) instead of AI-deriving checks from the
      // requirement prose. Ordinary Tasks keep the prose-scoped contract.
      const goalCriteriaIds =
        frontier.title === GOAL_ACCEPTANCE_TASK_TITLE
          ? graph.goal.config?.acceptance?.criteriaIds
          : undefined;
      const acceptance = await this.acceptanceService.ensureForSubject('task', task.id, {
        config: {
          enabled: true,
          ...(goalCriteriaIds?.length ? { verifyCriteriaIds: goalCriteriaIds } : {}),
        },
        requirement: this.buildTaskAcceptanceRequirement(
          graph,
          frontier.title,
          frontier.description,
        ),
      });
      acceptanceId = acceptance.id;
      const bound = await this.coordinatorGraph.bindTask(goalId, frontier.id, task.id);
      if (!bound) {
        await this.acceptanceService.acceptanceModel.delete(acceptance.id);
        await this.taskModel.delete(task.id);
        return {
          goalId,
          message: 'Responsible task was created by another coordinator',
          nodeId: frontier.id,
          outcome: 'waiting_external',
        };
      }
    } catch (error) {
      if (acceptanceId) {
        await this.acceptanceService.acceptanceModel.delete(acceptanceId).catch(() => {});
      }
      if (task) {
        await this.taskModel.delete(task.id).catch((cleanupError) => {
          console.error('[GoalService.tick] failed to delete unbound task:', cleanupError);
        });
      }
      await this.coordinatorGraph.updateNodeStatus(goalId, frontier.id, 'proposed');
      throw error;
    }

    effects.push({ nodeId: frontier.id, targetId: task.id, type: 'created_task' });
    const work = await this.workModel.registerTask({
      changeType: 'created',
      taskId: task.id,
      toolIdentifier: 'goal-coordinator',
      toolName: 'createResponsibleTask',
    });
    if (work?.currentVersionId) {
      await this.coordinatorGraph.attachWorkVersion(
        goalId,
        frontier.id,
        work.currentVersionId,
        'produced',
      );
    }
    await this.transitionStatus(graph.goal, 'running', `dispatched ${task.identifier}`);
    return {
      goalId,
      message: `Created responsible task ${task.identifier}`,
      nodeId: frontier.id,
      outcome: 'advanced',
      taskId: task.id,
    };
  };

  /**
   * Automatic recovery after a Task delivery failed verification. Spends the
   * Task's remaining attempt budget before it escalates to a person.
   */
  private recoverAfterVerification = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;
    const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
    const runs = await this.taskTopicModel.findWithHandoffByTaskIds(taskIds, 10_000);
    const totalCost = runs.reduce((sum, run) => sum + Number(run.totalCost ?? 0), 0);
    const recovery = await new TaskRecoveryCoordinator(
      this.db,
      this.userId,
      this.workspaceId,
    ).recover({ goal: graph.goal, spentCost: totalCost, task });

    if (recovery.outcome === 'started' || recovery.outcome === 'already-running') {
      await this.coordinatorGraph.updateNodeStatus(
        goalId,
        nodeId,
        'active',
        'Automatically started the next Task attempt after verification feedback',
      );
      await this.transitionStatus(graph.goal, 'running', 'automatic recovery started a run');
      // Only when this advance is the one that spawned the run. Reporting it
      // for a retry another advance owns would put a run in this trajectory
      // that it did not start, and attribute its cost here.
      if (recovery.outcome === 'started') {
        effects.push({
          detail: 'verification retry',
          nodeId,
          operationId: recovery.operationId,
          targetId: task.id,
          type: 'started_run',
        });
      }
      return {
        goalId,
        message: `Automatically retried task ${task.identifier}`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    // The retry never reached a device. The Task keeps that reason, and the next
    // advance waits for the device to come back rather than asking a person.
    if (recovery.outcome === 'spawn-failed' && recovery.deviceUnavailable) {
      return {
        goalId: graph.goal.id,
        message: `Task ${task.identifier} is waiting for its device to reconnect`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    // The goal was paused or ended (a close fenced it) while this advance was
    // deciding: start nothing and do not reopen it.
    if (recovery.outcome === 'goal-stopped') {
      return {
        goalId: graph.goal.id,
        message: 'Goal stopped while recovery was being decided',
        nodeId,
        outcome: 'no_progress',
        taskId: task.id,
      };
    }

    // Nothing failed: somebody settled the Task while this advance was deciding.
    // Opening a gate would ask them to judge their own decision.
    if (recovery.outcome === 'settled') {
      return {
        goalId: graph.goal.id,
        message: `Task ${task.identifier} was settled while recovery was being decided`,
        nodeId,
        outcome: 'no_progress',
        taskId: task.id,
      };
    }
    const exhaustedReason =
      recovery.outcome === 'exhausted-cost'
        ? 'Goal cost budget was exhausted'
        : recovery.outcome === 'exhausted-rounds'
          ? 'Task attempt budget was exhausted'
          : 'Automatic recovery could not start the next attempt';
    return this.gateOrTakeOver(graph, nodeId, task.id, exhaustedReason, effects, {
      machine: recovery.outcome === 'spawn-failed',
    });
  };

  /** Claim the task for dispatch and start its run. */
  private dispatchWork = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;

    // Advances arrive from independent sources — an event hook, a manual nudge,
    // the sweep — and can overlap. `runTask` decides whether a run is already
    // in flight by reading the task's topics and only then creating one, so two
    // overlapping advances would both dispatch this Task and pay for it twice.
    // Claim the task first: the transition is a single conditional UPDATE, so
    // exactly one advance can win it.
    //
    // Counting free slots is a *separate* race the per-task claim cannot cover:
    // two advances reading the same `inFlight` below the cap would each claim a
    // different task and both succeed, taking the goal past
    // `maxConcurrentTasks`. So the count and the claim happen together, under a
    // per-goal advisory lock — the planner's cap check is a fast path, this is
    // the enforcement.
    const claimed = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${GOAL_DISPATCH_LOCK_NAMESPACE}, hashtext(${goalId}))`,
      );

      const currentGoal = await new GoalModel(tx, this.userId, this.workspaceId).lockById(goalId);
      const currentGraph = await new GoalGraphModel(tx, this.userId, this.workspaceId).getGraph(
        goalId,
      );
      if (
        !currentGoal ||
        !currentGraph ||
        currentGoal.status !== 'running' ||
        currentGraph.decisions.some((item) => item.status === 'pending')
      )
        return 'stopped' as const;
      const currentBudget = await new GoalService(tx, this.userId, this.workspaceId).evaluateBudget(
        currentGoal,
        currentGraph,
      );
      if (
        currentBudget.costLimitReached ||
        currentBudget.roundLimitReached ||
        currentBudget.deadlinePassed
      )
        return 'stopped' as const;
      const inFlight = await new GoalGraphModel(
        tx,
        this.userId,
        this.workspaceId,
      ).countRunningTasks(goalId);
      if (inFlight >= resolveMaxConcurrentTasks(graph.goal)) return 'at-capacity' as const;

      return claimGoalTask(new TaskModel(tx, this.userId, this.workspaceId), task, 'running', {
        error: null,
        startedAt: new Date(),
      });
    });

    if (claimed === 'stopped')
      return {
        goalId,
        message: 'Goal is stopped or its execution budget is exhausted',
        outcome: 'no_progress',
        taskId: task.id,
      };

    if (claimed === 'at-capacity') {
      return {
        goalId,
        message: `Concurrency limit reached before ${task.identifier} could start`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }
    if (!claimed) {
      return {
        goalId,
        message: `Task ${task.identifier} is already being started`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    try {
      const run = await new TaskRunnerService(this.db, this.userId, this.workspaceId).runTask({
        extraPrompt:
          new GoalSupervisorService(this.db, this.userId, this.workspaceId).recoveryInstruction(
            graph,
            task.id,
          ) ??
          (graph.goal.config?.managerState?.submitted?.taskId === task.id
            ? graph.goal.config.managerState.submitted.reason
            : undefined),
        maxSteps: resolveTaskMaxSteps(graph.goal),
        taskId: task.id,
        trigger: 'goal',
      });
      await new GoalSupervisorService(this.db, this.userId, this.workspaceId).recordDispatch(
        graph,
        task.id,
        run.operationId,
      );
      effects.push({
        nodeId,
        operationId: run.operationId,
        targetId: task.id,
        type: 'started_run',
      });
      return {
        goalId,
        message: `Started task ${task.identifier}`,
        nodeId,
        outcome: 'waiting_external',
        taskId: run.taskId,
      };
    } catch (error) {
      // We claimed the task, so nothing else will put it back. Release it or the
      // Task stays 'running' with no run behind it and only the lease reclaims it.
      await this.taskModel
        .updateStatusIfCurrent(task.id, 'running', task.status)
        .catch((releaseError) => {
          console.error('[GoalService.tick] failed to release claimed task:', releaseError);
        });
      throw error;
    }
  };

  private requireGraph = async (goalId: string) => {
    const graph = await this.graphModel.getGraph(goalId);
    if (!graph) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return graph;
  };

  private ensureTaskWorkVersion = async (goalId: string, nodeId: string, taskId: string) => {
    const graph = await this.coordinatorGraph.getGraph(goalId);
    if (graph?.workVersions.some((link) => link.nodeId === nodeId)) return;
    const work = await this.workModel.registerTask({
      changeType: 'created',
      taskId,
      toolIdentifier: 'goal-coordinator',
      toolName: 'createResponsibleTask',
    });
    if (work?.currentVersionId) {
      await this.coordinatorGraph.attachWorkVersion(
        goalId,
        nodeId,
        work.currentVersionId,
        'produced',
      );
    }
  };

  private recoverAbandonedTask = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[] = [],
  ): Promise<GoalTickResult | undefined> => {
    const [runningTopic] = await this.taskTopicModel.findRunningByTaskIds([task.id]);
    const operationId = runningTopic?.operationId;
    const topicId = runningTopic?.topicId;
    const staleBefore = new Date(Date.now() - resolveOperationLeaseTimeout(graph.goal));

    if (!operationId || !topicId) {
      // No running topic covers two very different shapes. A verify-bound Task
      // that delivered keeps its task `running` with a *completed* topic until
      // the verify run settles, and that judgment — a full agent run — outlives
      // the operation lease routinely. Re-dispatching there pays for a duplicate
      // attempt the verify settle path will cancel, and the canceled retry then
      // becomes the newest topic and shadows the delivered one. Hold off while
      // the delivery is fresh; past the grace window, fall through to the
      // release below so a verify run that died silently cannot strand the
      // goal forever.
      const [lastTopic] = await this.taskTopicModel.findWithHandoff(task.id, 1);
      if (lastTopic?.status === 'completed') {
        const deliveredAt = lastTopic.completedAt ?? lastTopic.createdAt;
        if (new Date(deliveredAt).getTime() >= Date.now() - VERIFY_SETTLE_GRACE_MS) {
          return {
            goalId: graph.goal.id,
            message: `Task ${task.identifier} delivered; waiting for verification to settle`,
            nodeId,
            outcome: 'waiting_external',
            taskId: task.id,
          };
        }
      }

      // A task claimed for dispatch but with no run behind it. Normally this is
      // the sliver between the claim and `runTask` creating the topic; if the
      // worker died in there it is permanent, and every later advance would
      // report `waiting_external` forever because there is no operation to
      // reclaim. Once the claim is older than the lease, hand it back.
      if (new Date(task.updatedAt) >= staleBefore) return undefined;
      const released = await this.taskModel.updateStatusIfCurrent(task.id, 'running', 'backlog');
      if (!released) return undefined;
      return {
        goalId: graph.goal.id,
        message: `Released the abandoned dispatch claim on task ${task.identifier}`,
        nodeId,
        outcome: 'advanced',
        taskId: task.id,
      };
    }

    const latestUsage = await new AgentRuntimeCoordinator().getOperationMetadata(operationId);
    const reclaimed = await this.db.transaction(async (tx) => {
      const operationModel = new AgentOperationModel(tx, this.userId, this.workspaceId);
      const settled = await operationModel.settleStaleRunning(
        operationId,
        staleBefore,
        latestUsage?.totalCost,
      );
      if (!settled && !(await isOrphanedRun(operationModel, operationId, staleBefore)))
        return false;

      await new TaskTopicModel(tx, this.userId, this.workspaceId).updateStatus(
        task.id,
        topicId,
        'timeout',
      );
      await new TaskModel(tx, this.userId, this.workspaceId).updateStatus(task.id, 'paused', {
        error: LEASE_EXPIRED_ERROR,
      });
      return true;
    });
    if (!reclaimed) return undefined;

    return this.recoverLostRun(graph, nodeId, task, effects);
  };

  /**
   * Recover a Task whose run was lost rather than judged — its lease expired or
   * the gateway watchdog abandoned it.
   *
   * A run lost because its device went offline mid-run is the same failure as a
   * dispatch that never reached the device, only noticed later: the laptop went
   * to sleep with the run on it. It is re-marked as an offline run so it neither
   * spends the attempt budget nor retries into a device that is still gone.
   */
  private recoverLostRun = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[] = [],
  ): Promise<GoalTickResult> => {
    await this.markRunLostToOfflineDevice(task.id);
    const held = await this.holdForOfflineDevice(graph, nodeId, task, effects);
    if (held) return held;
    return this.resumeAbandonedTaskRecovery(graph, nodeId, task, effects);
  };

  /**
   * Re-mark the Task's latest lost run as an offline run when the device it ran
   * on is offline now. Only a device the gateway can vouch for counts: without
   * presence the run stays a charged attempt, exactly as before.
   */
  private markRunLostToOfflineDevice = async (taskId: string) => {
    const [latest] = await this.taskTopicModel.findWithHandoff(taskId, 1);
    if (!latest?.topicId || (latest.status !== 'timeout' && latest.status !== 'failed')) return;
    if ((await this.readRunDevicePresence(latest)) !== 'offline') return;
    await this.taskTopicModel.updateStatus(taskId, latest.topicId, DEVICE_OFFLINE_RUN_STATUS);
  };

  private resumeAbandonedTaskRecovery = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[] = [],
  ): Promise<GoalTickResult> => {
    const recovery = await new TaskRecoveryCoordinator(
      this.db,
      this.userId,
      this.workspaceId,
    ).recover({ goal: graph.goal, task });
    if (recovery.outcome === 'started' || recovery.outcome === 'already-running') {
      await this.coordinatorGraph.updateNodeStatus(
        graph.goal.id,
        nodeId,
        'active',
        'Recovered an abandoned Task operation and started the next attempt',
      );
      await this.transitionStatus(graph.goal, 'running', 'reclaimed an abandoned Task');
      if (recovery.outcome === 'started') {
        effects.push({
          detail: 'abandoned operation retry',
          nodeId,
          operationId: recovery.operationId,
          targetId: task.id,
          type: 'started_run',
        });
      }
      return {
        goalId: graph.goal.id,
        message: `Recovered abandoned task ${task.identifier}`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    // The retry never reached a device. The Task keeps that reason, and the next
    // advance waits for the device to come back rather than asking a person.
    if (recovery.outcome === 'spawn-failed' && recovery.deviceUnavailable) {
      return {
        goalId: graph.goal.id,
        message: `Task ${task.identifier} is waiting for its device to reconnect`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    // The goal was paused or ended (a close fenced it) while this advance was
    // deciding: start nothing and do not reopen it.
    if (recovery.outcome === 'goal-stopped') {
      return {
        goalId: graph.goal.id,
        message: 'Goal stopped while recovery was being decided',
        nodeId,
        outcome: 'no_progress',
        taskId: task.id,
      };
    }

    // Nothing failed: somebody settled the Task while this advance was deciding.
    // Opening a gate would ask them to judge their own decision.
    if (recovery.outcome === 'settled') {
      return {
        goalId: graph.goal.id,
        message: `Task ${task.identifier} was settled while recovery was being decided`,
        nodeId,
        outcome: 'no_progress',
        taskId: task.id,
      };
    }
    const reason =
      recovery.outcome === 'exhausted-cost'
        ? 'Goal cost budget was exhausted after an operation was abandoned'
        : recovery.outcome === 'exhausted-rounds'
          ? 'Task attempt budget was exhausted after an operation was abandoned'
          : 'Automatic recovery could not restart an abandoned operation';
    return this.gateOrTakeOver(graph, nodeId, task.id, reason, effects, {
      machine: recovery.outcome === 'spawn-failed',
    });
  };

  /** The machine-recovery plan for a paused Task, over its runs since a person last answered its gate. */
  private planMachineRecoveryFor = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    now = new Date(),
  ) => {
    // A person's Retry restarts the schedule they overrode.
    const answeredAt = lastAnsweredGateAt(graph, nodeId);
    const runs = (await this.taskTopicModel.findByTaskId(task.id)).filter(
      (run) => !answeredAt || new Date(run.updatedAt) > answeredAt,
    );
    return planMachineRecovery({ error: task.error, now, runs, taskUpdatedAt: task.updatedAt });
  };

  /**
   * Recover a Task stopped by a machine problem without asking anyone to judge it
   * (see `planMachineRecovery`): a usage limit is waited out until it resets, a
   * transport fault is retried a few times, and neither run spends the attempt
   * budget. A broken setup — or a schedule that ran out — opens a machine gate
   * that says what to fix. Judgment failures return nothing and keep the
   * supervisor and the ordinary gate.
   */
  private holdForMachineFailure = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult | undefined> => {
    if (task.status !== 'paused' || !task.error) return;
    // A supervised goal already has an owner for transport faults: the supervisor
    // diagnoses and retries them (see `recoveryEligibility`), so the deterministic
    // schedule stays out of its way rather than racing it for the same Task.
    const supervised = !!graph.goal.config?.supervision?.enabled || !!graph.goal.config?.manager;
    if (supervised && classifyGoalFailure(task.error).class === 'transient') return;
    const now = new Date();
    const plan = await this.planMachineRecoveryFor(graph, nodeId, task, now);
    if (plan.action === 'none') return;
    // A pause somebody made is theirs; the error text it kept proves nothing.
    if (statusAuthoredByActor(await this.taskModel.getActivities(task.id, 20), task.status)) return;

    if (plan.action === 'gate')
      return this.gateOrTakeOver(graph, nodeId, task.id, plan.reason, effects, { machine: true });
    if (plan.action === 'retry')
      return this.resumeAbandonedTaskRecovery(graph, nodeId, task, effects);

    // The sweep re-ticks a held goal, but only on its own cadence; the tick that
    // first sees the failure also books an advance for the retry time. Later
    // sweep ticks do not, so a long hold does not pile up queued advances.
    if (now.getTime() - plan.failedAt.getTime() <= MACHINE_HOLD_SCHEDULE_WINDOW_MS) {
      await scheduleGoalAdvance({
        delay: Math.max(
          1,
          Math.min(MAX_ADVANCE_DELAY_S, Math.ceil((plan.retryAt.getTime() - now.getTime()) / 1000)),
        ),
        goalId: graph.goal.id,
        trigger: 'wake',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    }
    return {
      goalId: graph.goal.id,
      message: `Task ${task.identifier}: ${plan.message}`,
      nodeId,
      outcome: 'waiting_external',
      taskId: task.id,
    };
  };

  /**
   * Hold a Task whose run could not reach its device until a device is back.
   *
   * A sleeping laptop or a restarting desktop app is the usual cause, and it
   * fixes itself: the gate it used to open waited hours for someone to press
   * Retry once the device had long reconnected. While the device is offline the
   * goal waits — the sweep keeps asking — and spends nothing; the retry then
   * goes through the ordinary recovery path.
   */
  private waitForDevice = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult | undefined> => {
    if (task.status !== 'paused' || !isDeviceUnavailableFailure(task.error)) return;
    const held = await this.holdForOfflineDevice(graph, nodeId, task, effects);
    if (held) return held;
    return this.resumeAbandonedTaskRecovery(graph, nodeId, task, effects);
  };

  /**
   * Hold a Task whose run a usage window refused until that window reopens.
   *
   * An external Agent past its session limit refuses every run until the reset
   * its error reports. The supervisor used to read that as "spending requires
   * user action" and open a gate, which then waited on a person to press Retry
   * long after the window had reset. The coordinator now waits out the reset
   * itself and retries through the ordinary recovery path, which charges the
   * attempt as before. That bounds a window that keeps refusing.
   */
  private waitForQuotaReset = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult | undefined> => {
    if (task.status !== 'paused') return;
    const [latest] = await this.taskTopicModel.findWithHandoff(task.id, 1);
    if (!latest?.operationId) return;
    const operation = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findById(latest.operationId);
    const failure = classifyRunFailure(operation?.error, task.error ?? '');
    if (failure.kind !== 'quota_reset') return;
    // A refusal whose text names the limit is recorded as an uncharged run
    // (`resolveFailedRunStatus`), so the attempt budget no longer bounds a window
    // that keeps refusing; the uncharged quota schedule does. Once it is spent,
    // fall through and `holdForMachineFailure` asks a person to fix the account.
    if (
      classifyGoalFailure(task.error).class === 'quota' &&
      (await this.planMachineRecoveryFor(graph, nodeId, task)).action === 'gate'
    )
      return;
    const retryAt = failure.resetsAt! + QUOTA_RESET_MARGIN_MS;
    if (retryAt <= Date.now()) {
      // The retry is a paid run, and recovery only checks the Task's own attempts
      // and cost. Past the Goal's deadline, rounds or spend it is not this path's
      // to start: ordinary failure handling takes it, and that gates it.
      const budget = await this.evaluateBudget(graph.goal, graph);
      if (budget.costLimitReached || budget.roundLimitReached || budget.deadlinePassed) return;
      return this.resumeAbandonedTaskRecovery(graph, nodeId, task, effects);
    }
    // The sweep would get here too, but only on its own cadence; the reset is a
    // known time, so ask for that tick directly. One wake per Goal: the claim
    // fails while an earlier-or-equal wake is still pending. A reset further out
    // than the queue's longest delay is re-armed when the capped wake fires.
    const target = new Date(retryAt).toISOString();
    const armed = GoalWaitService.arm(target);
    // Claim on the reset itself, not on `armedUntil`: that rounds the delay up to
    // whole seconds from each tick's own clock, so two ticks before the same reset
    // would read as different wakes. Only a capped wake stores its earlier fire time.
    const capped = Date.parse(armed.armedUntil) < retryAt;
    if (
      await new GoalModel(this.db, this.userId, this.workspaceId).armQuotaRetryWake(
        graph.goal.id,
        capped ? armed.armedUntil : target,
      )
    )
      await new GoalWaitService(this.db, this.userId, this.workspaceId).schedule(
        graph.goal.id,
        armed.delay,
      );
    return {
      goalId: graph.goal.id,
      message: `Task ${task.identifier} is waiting for its usage window to reset at ${new Date(retryAt).toISOString()}`,
      nodeId,
      outcome: 'waiting_external',
      taskId: task.id,
    };
  };

  /**
   * The offline retry schedule. Offline runs are not charged to the attempt
   * budget, so this is what bounds them: each consecutive one pushes the next
   * retry further out (see `nextDeviceOfflineRetryAt`), and once the offline
   * retries are spent a person is asked. Presence only brings a retry forward —
   * a device seen back online is retried at once — so a deployment without a
   * device gateway, or a run with no recorded device, still retries on schedule.
   *
   * Returns nothing when the Task should retry now.
   */
  private holdForOfflineDevice = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult | undefined> => {
    const runs = await this.taskTopicModel.findByTaskId(task.id);
    const offlineRuns = countConsecutiveDeviceOfflineRuns(runs);
    // A dispatch failure is an offline run even when it left no run behind.
    if (!offlineRuns && !isDeviceUnavailableFailure(task.error)) return;

    const lastFailureAt = new Date(offlineRuns ? runs[0].updatedAt : task.updatedAt);
    const retryAt = nextDeviceOfflineRetryAt(offlineRuns, lastFailureAt);
    if (!retryAt)
      return this.gateOrTakeOver(graph, nodeId, task.id, DEVICE_OFFLINE_GATE_REASON, effects, {
        machine: true,
      });
    if (retryAt.getTime() <= Date.now()) return;

    const [latest] = await this.taskTopicModel.findWithHandoff(task.id, 1);
    if (latest && (await this.readRunDevicePresence(latest)) === 'online') return;

    return {
      goalId: graph.goal.id,
      message: `Task ${task.identifier} is waiting for its device to reconnect; next retry at ${retryAt.toISOString()}`,
      nodeId,
      outcome: 'waiting_external',
      taskId: task.id,
    };
  };

  /**
   * Whether the device a run was routed to is connected right now.
   *
   * Presence is read for the exact device the run used, in the pool it was
   * routed through: a workspace goal may run on a personal device, and another
   * device coming online proves nothing about this one. A failed dispatch
   * records its route on the operation error; a run that got going leaves its
   * device on the topic. A topic bound to a device without a recorded pool is
   * looked up in every pool this goal can route through.
   */
  private readRunDevicePresence = async (run: {
    metadata?: ChatTopicMetadata | null;
    operationId?: string | null;
  }): Promise<'offline' | 'online' | 'unknown'> => {
    if (!deviceGateway.isConfigured) return 'unknown';

    const operation = run.operationId
      ? await new AgentOperationModel(this.db, this.userId, this.workspaceId).findById(
          run.operationId,
        )
      : undefined;
    const dispatchRoute = readDeviceDispatchRoute(operation?.error);
    const running = run.metadata?.runningOperation;
    const runningDevice =
      running?.deviceId && running.operationId === run.operationId ? running : undefined;

    let deviceId: string | undefined;
    let pools: { userId: string; workspaceId?: string }[];
    if (dispatchRoute) {
      deviceId = dispatchRoute.deviceId;
      pools = [{ userId: dispatchRoute.userId, workspaceId: dispatchRoute.workspaceId }];
    } else if (runningDevice) {
      deviceId = runningDevice.deviceId;
      pools = [
        {
          userId: runningDevice.deviceUserId ?? this.userId,
          workspaceId: runningDevice.deviceWorkspaceId,
        },
      ];
    } else {
      deviceId = run.metadata?.boundDeviceId;
      pools = [
        { userId: this.userId },
        ...(this.workspaceId ? [{ userId: this.userId, workspaceId: this.workspaceId }] : []),
      ];
    }
    if (!deviceId) return 'unknown';

    for (const pool of pools) {
      const devices = await deviceGateway.queryDeviceList(pool.userId, pool.workspaceId);
      if (devices.some((device) => device.deviceId === deviceId)) return 'online';
    }
    return 'offline';
  };

  private buildTaskInstruction = (
    graph: GoalGraphSnapshot,
    title: string,
    description: string | null,
  ) =>
    [
      `Overall goal context (background only): ${graph.goal.title}`,
      graph.goal.requirement
        ? `Overall goal acceptance context (background only): ${graph.goal.requirement}`
        : undefined,
      `Current Task contract (authoritative execution scope): ${title}`,
      description,
      'Execute only the Current Task contract. Do not implement, validate, or pre-empt any sibling or downstream Task node, even when the overall goal context describes it.',
      'The complete requirements for this Task are included here. Do not inspect unrelated agent documents to recover requirements. This Task carries its own Acceptance: run it inside this Task — drive the real product surface, capture the evidence, and submit it against your own criteria while you work. Submit evidence only; an independent verifier judges whether this Task is complete.',
      'For a Task that owns implementation, missing or broken capabilities within its scope are work to implement or repair, not a reason to stop at a capability report or ask the user for a finished implementation. Establish the runnable environment needed to exercise your changes, within the authorized scope. After failed verification, use the feedback to change the implementation or resolve the prerequisite before repeating the same checks; report a blocker only when progress requires unavailable external access, a user decision, or work outside this Task.',
      'For an investigation-only Task, deliver supported findings, gaps, and actionable next steps; do not silently expand into implementation. For a verification-only Task, report missing behavior honestly and identify the prerequisite or implementation work needed. Never claim a working product from a report or weaken the Current Task pass conditions to make it pass.',
      'Create implementation-level subtasks when useful. Finish the operation once the Current Task deliverable and its concrete evidence are ready; Acceptance verification will decide whether this Task is complete.',
      'Make the final delivery self-contained for an independent verifier that may not have workspace access. Include the relevant artifact contents or exact excerpts and the raw outputs of decisive verification commands; file paths and claims that checks passed are not sufficient evidence by themselves.',
      // A path on the machine that happened to run the task is not a
      // deliverable: the goal page cannot open it, the reviewer cannot read it,
      // and /tmp does not survive the week. Only artifacts that reach the
      // product are harvested onto the Goal Graph (see attachTaskDeliverables).
      'Persist every deliverable inside the product, not only on the local disk. Write reports and analyses as agent documents, and produce generated files (pptx / xlsx / docx / pdf, …) in the operation workspace so they are uploaded and registered. A local path such as /tmp or a repository directory is a working location, not a delivery — anything left only there is unreviewable and is not attached to the Goal.',
      'Return the produced artifacts, evidence, key findings, and the recommended next action. Do not mark the overall Goal complete.',
    ]
      .filter(Boolean)
      .join('\n\n');

  /**
   * Turn a goal with no tasks into an explorable structure: the LLM plans the
   * core question plus 1–5 independent directions, each carrying only its own
   * deliverable requirements. A planning failure degrades to one task seeded
   * from the raw requirement — the goal must never stall on its planner.
   */
  private planDecomposition = async (graph: GoalGraphSnapshot, effects: GoalAdvanceEffect[]) => {
    const goalId = graph.goal.id;
    const problem = graph.nodes.find((node) => node.kind === 'problem');
    const requirement = graph.goal.requirement ?? problem?.description ?? graph.goal.title;

    const claim = await this.goalModel.claimPlanning(goalId);
    if (!claim)
      return {
        goalId,
        message: 'Another advance is already planning this goal or tasks already exist',
        outcome: 'waiting_external' as const,
      };
    try {
      if (claim.previousStatus === 'planning') {
        await this.coordinatorGraph
          .recordGoalStatus(goalId, 'planning', 'running', 'decomposition claimed')
          .catch((error) => console.error('[GoalService] failed to record goal status:', error));
      }

      const generator = new GoalCriteriaGeneratorService(this.db, this.userId, this.workspaceId);
      const clarifications = collectClarificationAnswers(graph);
      const plan = await generator
        .decompose({ clarifications, requirement })
        .catch(() => undefined);
      // A graph without a problem node has nowhere to hang a question, so its
      // questions are planned around as assumptions like a re-plan's would be.
      const understanding = plan
        ? normalizeUnderstanding(
            plan,
            hasAskedClarification(graph) || !problem,
            clarifications.map((item) => item.question),
          )
        : undefined;

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
      const committed = await this.db.transaction(async (tx) => {
        const goalModel = new GoalModel(tx, this.userId, this.workspaceId);
        const current = await goalModel.findByIdForUpdate(goalId);
        const checkpoint = current?.config?.planningCheckpoint;
        if (
          !current ||
          current.status !== 'running' ||
          checkpoint?.token !== claim.token ||
          Date.parse(checkpoint.expiresAt) <= Date.now()
        )
          return undefined;
        const writer = new GoalGraphModel(tx, this.userId, this.workspaceId, {
          id: GOAL_COORDINATOR_ACTOR_ID,
          type: 'system',
        });
        const fresh = await writer.getGraph(goalId);
        if (!fresh || fresh.nodes.some((node) => node.kind === 'task')) return undefined;
        const currentProblem = fresh.nodes.find((node) => node.kind === 'problem');
        if (
          fresh.goal.requirement !== graph.goal.requirement ||
          fresh.goal.title !== graph.goal.title ||
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
              requestedUserId: this.userId,
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
                { minUnits: existingRollout?.minHomogeneousUnits },
              )
            : { batch: false, reasons: [] as string[] };

        if (rolloutClaim && rolloutEnabled && verdict.batch && currentProblem) {
          const roster = normalizeRolloutRoster(rolloutClaim.units, draftTasks, draftTasks.length);
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

          const batch = await writer.createNode(goalId, {
            description: rolloutClaim.recipeOutline,
            kind: 'batch',
            title: GOAL_BATCH_TITLE,
          });
          if (!batch) throw new Error('Failed to create a planned batch');
          await writer.createEdge(goalId, currentProblem.id, batch.id, 'decomposes');

          const template = await writer.createNode(goalId, {
            description: rolloutClaim.recipeOutline,
            kind: 'finding',
            scopeId: batch.id,
            title: GOAL_BATCH_TEMPLATE_TITLE,
          });
          if (!template) throw new Error('Failed to create a batch template');

          // The Assay is the gate. It is a `decision` node so a failed gate has
          // somewhere to hang the human question, but it carries NO pending
          // decision yet — opening one now would park the goal before a probe ran.
          // A `full` roll-out skips the probe, so it opens no gate at all.
          const assay =
            rolloutTrigger === 'full'
              ? undefined
              : await writer.createNode(goalId, {
                  description:
                    'Whether this repeated batch can be delivered without further human decisions.',
                  kind: 'decision',
                  scopeId: batch.id,
                  status: 'proposed',
                  title: GOAL_BATCH_ASSAY_TITLE,
                });
          if (rolloutTrigger !== 'full' && !assay)
            throw new Error('Failed to create a batch assay');

          const probeDrafts = draftTasks.slice(0, canarySize);
          const probeIds: string[] = [];
          for (const draft of probeDrafts) {
            const node = await writer.createNode(goalId, {
              description: draft.instruction,
              kind: 'task',
              scopeId: batch.id,
              title: draft.title,
            });
            if (!node) throw new Error('Failed to create a probe task');
            probeIds.push(node.id);
            committedEffects.push({ nodeId: node.id, type: 'created_node', detail: draft.title });
          }

          // The gate depends on every probe: `selectFrontier` reads `depends_on`
          // as blocks, so the gate cannot be evaluated until they settle.
          if (assay) {
            for (const probeId of probeIds) {
              await writer.createEdge(goalId, assay.id, probeId, 'depends_on');
            }
          }
          // Honour the planner's own intra-probe dependencies too.
          for (const [index, draft] of probeDrafts.entries()) {
            for (const dep of new Set(draft.dependsOn ?? [])) {
              if (dep < index && probeIds[dep]) {
                await writer.createEdge(goalId, probeIds[index], probeIds[dep], 'depends_on');
              }
            }
          }

          // A `full` roll-out releases the rest of the roster immediately, as the
          // single wave the trigger promises; `canary` waits for the gate.
          const massNodeIds: string[] = [];
          if (rolloutTrigger === 'full') {
            for (const title of roster.slice(probeIds.length)) {
              const nodeId = await createRecipeUnitTask(
                writer,
                goalId,
                batch.id,
                title,
                rolloutClaim.recipeOutline,
              );
              if (nodeId) massNodeIds.push(nodeId);
            }
          }

          const rolloutState: GoalRolloutState = {
            batchNodeId: batch.id,
            assayNodeId: assay?.id,
            massNodeIds: massNodeIds.length ? massNodeIds : undefined,
            phase: rolloutTrigger === 'full' ? 'mass' : 'probe',
            probeNodeIds: probeIds,
            releasedCount: probeIds.length + massNodeIds.length,
            templateNodeId: template.id,
            templateRevision: 1,
            unitTitles: roster,
            waveIndex: rolloutTrigger === 'full' ? 1 : 0,
          };
          await goalModel.updateRolloutState(goalId, rolloutState);

          if (!existingRollout) {
            await goalModel.updateRolloutPolicy(goalId, {
              canarySize: rolloutTrigger === 'full' ? undefined : canarySize,
              spec: {
                recipeOutline: rolloutClaim.recipeOutline,
                repeatable: rolloutClaim.repeatable,
                variantAxes: rolloutClaim.variants,
              },
              trigger: rolloutTrigger,
              units: roster,
              waveSize: ROLLOUT_WAVE_SIZE_DEFAULT,
            });
          }
          return committedEffects;
        }

        const createdIds: string[] = [];
        for (const draft of draftTasks) {
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
            title: draft.title,
          });
          if (!node) throw new Error('Failed to create a planned task');
          if (!experiment && currentProblem)
            await writer.createEdge(goalId, currentProblem.id, node.id, 'decomposes');
          createdIds.push(node.id);
          committedEffects.push({ nodeId: node.id, type: 'created_node', detail: draft.title });
        }

        // The planner's `dependsOn` indices become `depends_on` edges, drawn
        // dependent → prerequisite the way `decideNextMove` reads a blocker. Only
        // earlier indices are honoured, so a hallucinated forward or self reference
        // can never form a cycle that deadlocks the frontier.
        for (const [index, draft] of draftTasks.entries()) {
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
        await this.briefs.openClarification(
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
      await this.goalModel.releasePlanning(goalId, claim.token);
    }
  };

  /**
   * Judge a repeated batch's gate, but only once the wave it released has fully
   * settled. Returns undefined when there is nothing to judge: no batch, a batch
   * that has released its whole roster, a batch already parked on a pattern
   * break, or a wave still running (the ordinary frontier owns that tick).
   */
  private collectRolloutGate = (graph: GoalGraphSnapshot): RolloutGateResult | undefined => {
    const policy = graph.goal.config?.rollout;
    const state = graph.goal.config?.rolloutState;
    if (!policy || !state || state.phase === 'done' || state.phase === 'pattern_break')
      return undefined;
    const roster = state.unitTitles ?? [];
    const released = state.releasedCount ?? state.probeNodeIds.length;
    const materializedIds = new Set([...state.probeNodeIds, ...(state.massNodeIds ?? [])]);
    const materialized = graph.nodes.filter((node) => materializedIds.has(node.id));
    if (materialized.some((node) => !TERMINAL_NODE_STATUSES.has(node.status))) return undefined;
    if (released >= roster.length) return undefined;
    return evaluateRolloutGate({ graph, policy, state });
  };

  /** Release the next wave of a repeated batch once its gate passed. */
  private releaseRolloutWave = async (
    graph: GoalGraphSnapshot,
    effects: GoalAdvanceEffect[],
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
      await this.goalModel.updateRolloutState(goalId, { ...state, phase: 'done' });
      return { goalId, message: 'Batch roster exhausted', outcome: 'advanced' };
    }

    const newIds: string[] = [];
    for (const title of wave) {
      const nodeId = await createRecipeUnitTask(
        this.coordinatorGraph,
        goalId,
        state.batchNodeId,
        title,
        policy.spec?.recipeOutline,
      );
      if (nodeId) {
        newIds.push(nodeId);
        effects.push({ detail: title, nodeId, type: 'created_node' });
      }
    }

    const next: GoalRolloutState = {
      ...state,
      massNodeIds: [...(state.massNodeIds ?? []), ...newIds],
      phase: 'mass',
      releasedCount: released + newIds.length,
      waveIndex: state.waveIndex + 1,
    };
    await this.goalModel.updateRolloutState(goalId, next);

    if (next.releasedCount! >= roster.length) {
      await this.goalModel.updateRolloutState(goalId, { ...next, phase: 'done' });
    }

    return {
      goalId,
      message: `Batch gate passed; released wave ${next.waveIndex} (${newIds.length} unit${newIds.length === 1 ? '' : 's'})`,
      outcome: 'advanced',
    };
  };

  /**
   * Hand a blocked batch gate to a person.
   *
   * The batch cannot advance on its own, so this opens a decision on the Assay
   * and pauses the goal with the pattern-break reason. The choice is the v3
   * fork: revise the same recipe (repeat the v1 → v2 loop) or treat it as a new
   * class and run it in parallel — never a silent park.
   */
  private openPatternBreakGate = async (
    graph: GoalGraphSnapshot,
    message: string,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;
    const state = graph.goal.config?.rolloutState;
    if (!state) return { goalId, message, outcome: 'waiting_human' };

    const nodeId = state.assayNodeId ?? state.batchNodeId;
    const reason = `${PATTERN_BREAK_PAUSE_REASON}: ${message}`;
    const decision = await this.coordinatorGraph.createDecision(goalId, nodeId, {
      authority: 'user',
      options: [
        {
          description: '按这一次的失败修订配方，然后重探这一批',
          id: 'revise',
          label: '修订配方并重探',
        },
        {
          description: '把它当成另一个同构类型，与当前批次并排处理',
          id: 'new_class',
          label: '作为新类型并排处理',
        },
      ],
      question: `${message}\n\n该如何处理这个批次？`,
      requestedUserId: this.userId,
    });
    await this.coordinatorGraph.updateNodeStatus(goalId, nodeId, 'waiting', reason);
    effects.push({
      detail: message,
      nodeId,
      targetId: decision?.id ?? nodeId,
      type: 'opened_decision',
    });
    await this.goalModel.updateRolloutState(goalId, { ...state, phase: 'pattern_break' });
    await this.setPauseReason(goalId, 'pattern_break');
    await this.transitionStatus(graph.goal, 'paused', reason);
    effects.push({ type: 'goal_status', detail: 'paused: pattern_break' });
    return { goalId, message, nodeId, outcome: 'waiting_human' };
  };

  /**
   * R5: restart the canary loop after a person intervened on a batch gate.
   *
   * The person's answer is the single human judgment; the coordinator opens the
   * next recipe round from it. `revise` chains a new Template onto the old one
   * (`revises`) and re-probes the next roster slice; `new_class` forks a fresh
   * Template with no chain edge. In both cases the members that broke are
   * retired and the rollout returns to the probe phase, so the class is proved
   * again from a fresh canary instead of a manual rerun.
   */
  private restartRolloutLoop = async (
    goalId: string,
    decision: { nodeId: string; question: string },
    optionId: string,
    resolution: string | undefined,
    chosen: GoalDecisionOption | undefined,
  ): Promise<void> => {
    const graph = await this.requireGraph(goalId);
    const policy = graph.goal.config?.rollout;
    const state = graph.goal.config?.rolloutState;
    if (!policy || !state) return;

    const batchId = state.batchNodeId;
    const roster = state.unitTitles ?? [];
    const released = state.releasedCount ?? state.probeNodeIds.length;
    const guidance = (resolution ?? chosen?.description ?? '').trim() || policy.spec?.recipeOutline;

    // 1. A new recipe revision, or a forked new class (no `revises` chain).
    const template = await this.coordinatorGraph.createNode(goalId, {
      description: guidance,
      kind: 'finding',
      scopeId: batchId,
      title: GOAL_BATCH_TEMPLATE_TITLE,
    });
    if (template && optionId !== 'new_class' && state.templateNodeId) {
      await this.coordinatorGraph.createEdge(goalId, template.id, state.templateNodeId, 'revises');
    }

    // 2. Retire the members that broke or were superseded, never delete them —
    // the new round is `derived_from` them (decision #4).
    const memberIds = new Set([...state.probeNodeIds, ...(state.massNodeIds ?? [])]);
    for (const node of graph.nodes) {
      if (memberIds.has(node.id) && !TERMINAL_NODE_STATUSES.has(node.status)) {
        await this.coordinatorGraph.updateNodeStatus(
          goalId,
          node.id,
          'retired',
          'superseded by a new recipe revision',
        );
      }
    }

    // 3. A fresh gate for the fresh round.
    const assay = await this.coordinatorGraph.createNode(goalId, {
      description: 'Whether this repeated batch can be delivered without further human decisions.',
      kind: 'decision',
      scopeId: batchId,
      status: 'proposed',
      title: GOAL_BATCH_ASSAY_TITLE,
    });
    if (!assay) return;

    // 4. Re-probe the next roster slice as the new canary.
    const canarySize = Math.max(
      2,
      Math.min(policy.canarySize ?? ROLLOUT_CANARY_SIZE_DEFAULT, ROLLOUT_MAX_CANARY_SIZE),
    );
    const wave = roster.slice(released, released + canarySize);
    const precedence = state.probeNodeIds[0] ?? memberIds.values().next().value;
    const probeIds: string[] = [];
    for (const title of wave) {
      const nodeId = await createRecipeUnitTask(
        this.coordinatorGraph,
        goalId,
        batchId,
        title,
        policy.spec?.recipeOutline,
      );
      if (!nodeId) continue;
      probeIds.push(nodeId);
      if (precedence) {
        await this.coordinatorGraph
          .createEdge(goalId, nodeId, precedence, 'derived_from')
          .catch(() => {});
      }
    }
    for (const probeId of probeIds) {
      await this.coordinatorGraph.createEdge(goalId, assay.id, probeId, 'depends_on');
    }

    // 5. Back to canary, on the new revision.
    await this.goalModel.updateRolloutState(goalId, {
      ...state,
      assayNodeId: assay.id,
      phase: 'probe',
      probeNodeIds: probeIds,
      releasedCount: released + probeIds.length,
      templateNodeId: template?.id ?? state.templateNodeId,
      templateRevision: state.templateRevision + 1,
      waveIndex: 0,
    });
    await this.setPauseReason(goalId, undefined);
  };

  private buildTaskAcceptanceRequirement = (
    graph: GoalGraphSnapshot,
    title: string,
    description: string | null,
  ) => {
    if (title === GOAL_ACCEPTANCE_TASK_TITLE) {
      return [
        `Terminal Goal acceptance requirement (authoritative): ${graph.goal.requirement ?? graph.goal.title}`,
        description ? `Required delivery: ${description}` : undefined,
        'PASS only when concrete evidence proves that every clause of the terminal Goal acceptance requirement is satisfied.',
        'An accurate gap analysis, a report that the Goal is not accepted, a suggested next action, or partial progress is NOT a passing delivery. Reject it so automatic recovery can continue or open a Gate.',
        'If any required count, field, evidence quality, or other explicit threshold is missing, the verdict MUST be failed even when the builder correctly identified and documented the gap.',
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    // The full goal requirement (with its numbered acceptance list) is NOT
    // injected here: it belongs to the terminal acceptance task above, and
    // pasting it into every Task made each task's acceptance read as the whole
    // contract. A Task is judged on its own outcome only.
    return [
      `Verify only this Task: ${title}.`,
      description ? `Required Task outcome: ${description}` : undefined,
      `This Task is one direction of the Goal "${graph.goal.title}"; the full Goal contract is verified separately at the end.`,
      'Pass only when the current Task deliverable is complete and supported by concrete evidence. Ignore sibling and downstream Task deliverables; they are verified by their own acceptance runs.',
    ]
      .filter(Boolean)
      .join('\n\n');
  };

  /**
   * Link what a task actually delivered to the node that ordered it.
   *
   * The task Work attached alongside is the execution container; these are its
   * outputs — the documents and external resources the run registered. Without
   * them the graph records that a task finished but not what it produced, and
   * the deliverable survives only as a URL buried in the finding's prose.
   *
   * Harvested across every run of the task, not just the delivering one: a task
   * that wrote its document in an earlier round and only revised it in the last
   * still delivered that document. Works are deduplicated by identity and
   * linked at their newest version, so a document refined across rounds is one
   * deliverable with a history rather than several deliverables.
   *
   * Two rules keep one deliverable from being declared once per task:
   *
   * - **Created only.** A Work none of the task's runs created is someone
   *   else's artifact this task happened to revise. A shared backlog document
   *   that every run appends to is the case that surfaced this: without the
   *   rule the document is declared as the output of every task in the goal.
   * - **Claimed once per goal.** The first node to deliver a Work owns it. A
   *   later node that revises it adds no link and no lifecycle event, so the
   *   history reads "C1-c delivered the backlog" instead of repeating the same
   *   deliverable under each task.
   *
   * `task` Works are deliberately excluded: the responsible task's own Work is
   * the execution container and the caller already links it. `file` Works are
   * opt-in at the registry (conversation lists do not want every exported
   * file), but a goal's deliverables are exactly where a produced deck or PDF
   * belongs, so they are requested explicitly here.
   */
  private attachTaskDeliverables = async (
    goalId: string,
    nodeId: string,
    operationIds: string[],
    effects: GoalAdvanceEffect[],
  ) => {
    if (operationIds.length === 0) return;

    // The per-operation cap is applied to version EVENTS before this dedupes by
    // Work identity, so the default of 20 lets a document revised twenty times
    // push every other deliverable out of its own task's list.
    const byOperation = await this.workModel.listByRootOperations({
      includeFileWorks: true,
      limit: DELIVERABLE_EVENTS_PER_RUN,
      rootOperationIds: operationIds,
    });

    const claimedWorkIds = await this.coordinatorGraph.listProducedWorkIds(goalId);

    // Per Work: whether the task's runs created it, and the newest version they
    // registered. `created` is sticky across the run's versions — a document
    // written in round one and revised in round three is still this task's
    // deliverable, while one that was only ever revised is not.
    const harvestByWork = new Map<string, { created: boolean; item: WorkVersionEventItem }>();
    for (const item of Object.values(byOperation).flat()) {
      if (item.type === 'task') continue;
      const seen = harvestByWork.get(item.id);
      const created = item.version.changeType === 'created';
      if (!seen) {
        harvestByWork.set(item.id, { created, item });
        continue;
      }
      harvestByWork.set(item.id, {
        created: seen.created || created,
        item: seen.item.version.createdAt < item.version.createdAt ? item : seen.item,
      });
    }

    for (const [workId, { created, item }] of harvestByWork) {
      if (!created || claimedWorkIds.has(workId)) continue;
      const link = await this.coordinatorGraph.attachWorkVersion(
        goalId,
        nodeId,
        item.version.id,
        'produced',
      );
      // `attachWorkVersion` is idempotent, so a re-settled task re-links the
      // same versions silently; only a genuinely new link is worth an effect.
      if (link)
        effects.push({
          detail: item.type,
          nodeId,
          targetId: item.id,
          type: 'attached_work_version',
        });
    }
  };

  private consumeCompletedTask = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    taskId: string,
    effects: GoalAdvanceEffect[] = [],
  ): Promise<GoalTickResult> => {
    // `graph` can predate a retirement that landed while this tick ran. A
    // retired node's late output must not enter the Goal as a finding or
    // deliverable (and `updateNodeStatus` refuses to revive the node).
    if ((await this.coordinatorGraph.getNodeStatus(graph.goal.id, nodeId)) === 'retired') {
      return {
        goalId: graph.goal.id,
        message: 'Node was retired; the task outcome is discarded',
        nodeId,
        outcome: 'no_progress',
        taskId,
      };
    }
    const existingFinding = graph.edges.some(
      (edge) => edge.sourceNodeId === nodeId && edge.kind === 'produces',
    );
    // The newest row by seq can be a retry that was canceled when verification
    // accepted an earlier delivery — the settle path cancels the in-flight
    // attempt it superseded. The finding must be synthesized from the run that
    // actually delivered, so prefer the newest completed topic (with a handoff
    // when one exists) over whatever happens to be last.
    const recent = await this.taskTopicModel.findWithHandoff(taskId, 10);
    const latest =
      recent.find((topic) => topic.status === 'completed' && topic.handoff) ??
      recent.find((topic) => topic.status === 'completed') ??
      recent[0];
    const completedWork = await this.workModel.registerTask({
      changeType: 'updated',
      rootOperationId: latest?.operationId,
      taskId,
      toolIdentifier: 'goal-coordinator',
      toolName: 'synthesizeTaskOutcome',
      topicId: latest?.topicId,
    });
    effects.push({
      nodeId,
      operationId: latest?.operationId ?? undefined,
      targetId: taskId,
      type: 'node_status',
      detail: 'resolved',
    });
    // The container link is written once per node — at dispatch, or by
    // `ensureTaskWorkVersion` for a node that never got one. Re-linking the
    // completed version only appended a second identical row for the same task:
    // the goal's task-container links were one per settle round instead of one
    // per node, which is where half of the graph's hidden Work links came from.
    const containerLinked = graph.workVersions.some(
      (link) =>
        link.nodeId === nodeId &&
        link.relation === 'produced' &&
        link.work?.workId === completedWork?.id,
    );
    if (completedWork?.currentVersionId && !containerLinked) {
      await this.coordinatorGraph.attachWorkVersion(
        graph.goal.id,
        nodeId,
        completedWork.currentVersionId,
        'produced',
      );
    }
    // Every run of the task, not the ten `findWithHandoff` reads for the
    // finding: an attempt budget above ten would otherwise strand a deliverable
    // produced early and merely referenced later.
    const allRuns = await this.taskTopicModel.findByTaskId(taskId);
    await this.attachTaskDeliverables(
      graph.goal.id,
      nodeId,
      allRuns.flatMap((topic) => (topic.operationId ? [topic.operationId] : [])),
      effects,
    );
    if (!existingFinding) {
      const handoff = latest?.handoff as TaskTopicHandoff | null;
      const title =
        handoff?.title ??
        handoff?.summary ??
        `Completed: ${graph.nodes.find((node) => node.id === nodeId)?.title}`;
      // The finding is written by whoever did the work. Recorded as the owner,
      // it read as something the person had said themselves.
      const author = (await this.taskModel.findById(taskId))?.assigneeAgentId ?? graph.goal.agentId;
      const finding = await this.coordinatorGraph.createNode(graph.goal.id, {
        confidence: 1,
        createdByAgentId: author ?? undefined,
        description: handoff?.content ?? handoff?.summary ?? undefined,
        kind: 'finding',
        scopeId: experimentOwner(graph, nodeId),
        status: 'resolved',
        title,
      });
      if (finding) {
        effects.push({ detail: 'finding', nodeId, targetId: finding.id, type: 'created_node' });
        await this.coordinatorGraph.createEdge(graph.goal.id, nodeId, finding.id, 'produces');
      }
    }
    await this.coordinatorGraph.updateNodeStatus(
      graph.goal.id,
      nodeId,
      'resolved',
      'Responsible task completed',
    );
    await new GoalSupervisorService(this.db, this.userId, this.workspaceId).recordProgress(
      graph,
      taskId,
      false,
      latest?.status === 'completed' ? (latest.operationId ?? undefined) : undefined,
    );
    return {
      goalId: graph.goal.id,
      message: 'Task outcome was synthesized into a finding',
      nodeId,
      outcome: 'advanced',
      taskId,
    };
  };

  /**
   * Every stop-on-a-person funnels through here, so this is the one place a main
   * Agent can be offered the problem before the Goal parks on its owner.
   *
   * The coordinator only reaches this point once its own policy is out of moves:
   * the failure matched no recovery branch, the attempt budget ran out, or the
   * reason is one it cannot classify. That is precisely the class of problem the
   * deterministic lane cannot express, so it is handed over rather than escalated.
   * A main Agent that cannot help answers `escalate`, and the gate opens anyway —
   * one turn later, with a diagnosis attached.
   */
  private gateOrTakeOver = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    taskId: string,
    reason: string,
    effects: GoalAdvanceEffect[] = [],
    gate: FailureGateOptions = {},
  ): Promise<GoalTickResult> => {
    const takeover = await new GoalManagerService(this.db, this.userId, this.workspaceId).takeOver(
      graph,
      { reason, taskId },
    );
    if (takeover) return takeover;
    // When the main Agent already looked at THIS problem, the gate carries what it
    // said: the person answering should see the Agent's reasoning, not just the
    // coordinator's own reason for stopping.
    const answered = answeredProblem(graph.goal.config?.managerState);
    const own = answered?.key === problemKey({ reason, taskId }) ? answered : undefined;
    // An Agent that asked a real question gets it asked as written, with its
    // own answers as the buttons; its diagnosis is what the gate stands on.
    if (own?.ask)
      return this.openFailureDecision(graph, nodeId, taskId, reason, effects, {
        ...gate,
        ask: { ...own.ask, diagnosis: own.reason },
      });
    const diagnosis = own ? own.reason.slice(0, 600) : undefined;
    return this.openFailureDecision(
      graph,
      nodeId,
      taskId,
      diagnosis ? `${reason} — main Agent: ${diagnosis}` : reason,
      effects,
      gate,
    );
  };

  private openFailureDecision = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    taskId: string,
    reason: string,
    effects: GoalAdvanceEffect[] = [],
    gate: FailureGateOptions = {},
  ): Promise<GoalTickResult> => {
    return this.db.transaction(async (tx) => {
      const currentGoal = await new GoalModel(tx, this.userId, this.workspaceId).lockById(
        graph.goal.id,
      );
      const service = new GoalService(tx, this.userId, this.workspaceId);
      const current = await service.requireGraph(graph.goal.id);
      if (
        !currentGoal ||
        ['paused', 'canceled', 'failed', 'achieved'].includes(currentGoal.status)
      ) {
        return {
          goalId: graph.goal.id,
          message: 'Goal was stopped while recovery was being evaluated',
          outcome: 'no_progress',
          taskId,
        };
      }
      const task = await new TaskModel(tx, this.userId, this.workspaceId).findById(taskId);
      if (task && ['running', 'backlog', 'completed'].includes(task.status)) {
        return {
          goalId: graph.goal.id,
          message: 'Task state changed while recovery was being evaluated',
          outcome: 'waiting_external',
          taskId,
        };
      }
      return service.openFailureDecisionLocked(current, nodeId, taskId, reason, effects, gate);
    });
  };

  private openFailureDecisionLocked = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    taskId: string,
    reason: string,
    effects: GoalAdvanceEffect[],
    gate: FailureGateOptions = {},
  ): Promise<GoalTickResult> => {
    const existingDecisionNode = graph.edges
      .filter((edge) => edge.sourceNodeId === nodeId && edge.kind === 'leads_to')
      .map((edge) => graph.nodes.find((node) => node.id === edge.targetNodeId))
      .find((node) => node?.kind === 'decision' && node.status !== 'resolved');
    if (!existingDecisionNode) {
      const terminalAcceptance =
        graph.nodes.find((candidate) => candidate.id === nodeId)?.title ===
        GOAL_ACCEPTANCE_TASK_TITLE;
      // The terminal acceptance gate keeps its own three-way shape: ending the
      // Goal is a verdict even when a machine problem is what stopped it.
      const machine = !!gate.machine && !terminalAcceptance;
      const { ask } = gate;
      const node = await this.coordinatorGraph.createNode(graph.goal.id, {
        // What the gate stands on: the main Agent's diagnosis when it asked,
        // else the coordinator's own reason for stopping.
        description: ask ? `${reason}\n\n${ask.diagnosis}` : reason,
        kind: 'decision',
        status: 'waiting',
        title: machine ? GOAL_MACHINE_GATE_TITLE : 'Choose how to recover failed task',
        scopeId: experimentOwner(graph, nodeId),
      });
      if (node) {
        effects.push({ detail: reason, nodeId, targetId: node.id, type: 'opened_decision' });
        await this.coordinatorGraph.createEdge(graph.goal.id, nodeId, node.id, 'leads_to');
        const decision = await this.coordinatorGraph.createDecision(
          graph.goal.id,
          node.id,
          ask
            ? {
                authority: 'user',
                options: ask.options,
                question: ask.question,
                recommendedOptionId: ask.recommendedOptionId,
                requestedUserId: this.userId,
              }
            : {
                authority: 'user',
                options: machine
                  ? [
                      { id: 'retry', label: 'I fixed it — retry' },
                      { id: 'retire', label: 'Retire task' },
                    ]
                  : terminalAcceptance
                    ? [
                        { id: 'retry', label: 'Retry goal acceptance' },
                        // Drop the acceptance Task and end the Goal without a verdict —
                        // unlike `fail`, which records that the Goal was judged failed.
                        { id: 'retire', label: 'Abandon goal acceptance' },
                        { id: 'fail', label: 'Fail goal' },
                      ]
                    : [
                        { id: 'retry', label: 'Retry task' },
                        { id: 'retire', label: 'Retire task' },
                      ],
                question: machine
                  ? `${reason}. Fix it, then retry or retire this task node?`
                  : terminalAcceptance
                    ? `${reason}. Retry Goal acceptance, abandon it, or fail this Goal?`
                    : `${reason}. Retry or retire this task node?`,
                recommendedOptionId: 'retry',
                requestedUserId: this.userId,
              },
        );
        if (decision)
          await this.briefs.openDecision(graph.goal, {
            decisionId: decision.id,
            options: decision.options,
            question: decision.question,
            recommendedOptionId: decision.recommendedOptionId,
          });
      }
    }
    await this.coordinatorGraph.updateNodeStatus(graph.goal.id, nodeId, 'waiting', reason);
    await this.transitionStatus(graph.goal, 'review', reason);
    return {
      goalId: graph.goal.id,
      message: 'Task failed; a human decision gate was opened',
      nodeId,
      outcome: 'waiting_human',
      taskId,
    };
  };
}

interface FailureGateOptions {
  /** The main Agent's own question for this gate, asked as written with its diagnosis. */
  ask?: GoalManagerAsk & { diagnosis: string };
  /**
   * The gate is about a machine problem (broken setup, spent retry schedule), not
   * the work: it opens as a machine gate that asks for a fix, not a judgment.
   */
  machine?: boolean;
}

/** A machine hold books its own advance only from the tick that first saw the failure. */
const MACHINE_HOLD_SCHEDULE_WINDOW_MS = 15 * 60 * 1000;
/** Queue delays are bounded; the sweep covers anything further out. */
const MAX_ADVANCE_DELAY_S = 86_400;

/**
 * Whether a Task topic is still `running` although its run has already ended.
 *
 * The run's terminal normally moves the topic through the task lifecycle hook,
 * but that delivery can be lost — a watchdog-abandoned device run had none at
 * all, and a dropped webhook has no retry. The lease reclaim cannot see these:
 * it only settles an operation that is itself still `running`, so the Task
 * stays in flight forever and its goal with it. Once the run has been over for
 * longer than the lease, nothing is left to report it and the topic is lost.
 *
 * A missing operation row proves nothing — a run executed on the client never
 * writes one — so only a row that says the run ended counts.
 */
const isOrphanedRun = async (
  operationModel: AgentOperationModel,
  operationId: string,
  staleBefore: Date,
): Promise<boolean> => {
  const operation = await operationModel.findById(operationId);
  // Still-owned states (including a run parked for a client) are the lease
  // path's to reclaim, not this.
  if (!operation || isAgentOperationInFlight(operation.status)) return false;
  const endedAt = operation.completedAt ?? operation.updatedAt;
  return new Date(endedAt) < staleBefore;
};
