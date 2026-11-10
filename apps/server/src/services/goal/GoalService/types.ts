import type {
  GoalCreateConfig,
  GoalNodeKind,
  GoalNodeStatus,
  GoalVisibility,
} from '@lobechat/types';
import type { GoalSeedTask } from '@lobechat/utils/goalSeeds';

import type { AgentModel } from '@/database/models/agent';
import type { GoalModel } from '@/database/models/goal';
import type { GoalGraphModel } from '@/database/models/goalGraph';
import type { TaskModel } from '@/database/models/task';
import type { TaskTopicModel } from '@/database/models/taskTopic';
import type { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';

import type { TaskService } from '../../task';
import type { AcceptanceService } from '../../verify/acceptanceService';
import type { GoalBriefService } from '../goalBriefs';
import type { GoalReleaseReview } from '../releaseReview';
import type {
  attachTaskDeliverables,
  consumeCompletedTask,
  recoverAfterVerification,
  settleTerminalAcceptance,
} from './completion';
import type { bindTopic, create, createFromConversation, resolveTopicRun } from './creation';
import type {
  answerClarifications,
  decide,
  gateOrTakeOver,
  openFailureDecision,
  openFailureDecisionLocked,
  reopenForChanges,
} from './decisions';
import type {
  buildTaskAcceptanceRequirement,
  buildTaskInstruction,
  createResponsibleTask,
  dispatchWork,
  ensureTaskWorkVersion,
} from './dispatch';
import type {
  addEdge,
  addNode,
  followGoalAgent,
  goalOwnerTaskScope,
  graphAs,
  reassignUnfinishedTasks,
  resolveTaskAssignee,
  retireNodes,
  setAgent,
  setBudget,
  setModel,
  setTaskAgent,
  setTaskModel,
  stopFencedTasks,
  updateRequirement,
  updateTitle,
} from './editing';
import type {
  close,
  deleteGoal,
  pause,
  requestSignOff,
  restart,
  resume,
  transitionStatus,
} from './lifecycle';
import type {
  evaluateBudget,
  evaluateMetricCriteria,
  isParkedOnMeasuredGate,
  recordObservation,
  reopenIfMeasurementCleared,
  resolveSpend,
  setAcceptanceCriteria,
  setMetricCriteria,
  setPauseReason,
} from './measurement';
import type { handPlanningToMainAgent, planDecomposition } from './planning';
import type {
  collectAcceptances,
  collectAssignees,
  collectDeliveredAt,
  collectQuotaWaits,
  collectRunHeartbeats,
  graph,
  listEvents,
  pendingClarifications,
  pendingForIsland,
  requireGraph,
  status,
} from './reads';
import type {
  holdForMachineFailure,
  holdForOfflineDevice,
  markRunLostToOfflineDevice,
  planMachineRecoveryFor,
  readRunDevicePresence,
  recoverAbandonedTask,
  recoverLostRun,
  resumeAbandonedTaskRecovery,
  waitForDevice,
  waitForQuotaReset,
} from './recovery';
import type {
  collectRolloutGate,
  isBatchMember,
  openPatternBreakGate,
  restartRolloutLoop,
} from './rollout';
import type { dispatchGoalReport, tick, tickOnce } from './tick';

export type CreateGoalTaskInput = GoalSeedTask;

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
  /**
   * Create the goal as a `draft`: the graph can be arranged, and nothing is
   * dispatched until `GoalStartService.start` launches it.
   */
  draft?: boolean;
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
   * Seed task nodes; `dependsOn` names other seeds by title. A plain string is title-only.
   * When omitted, the coordinator plans the decomposition on first advance.
   */
  tasks?: Array<CreateGoalTaskInput | string>;
  title: string;
  /**
   * The conversation this goal was created from. Recorded as the goal's
   * `topic` subject so the conversation can find and show it.
   */
  topicId?: string;
  /**
   * Workspace visibility. Omitted, it follows the agents: a private goal or
   * task agent makes the goal private, otherwise it is public. An explicit
   * 'public' with a private agent is rejected.
   */
  visibility?: GoalVisibility;
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

/** The arguments a service method takes after its `ctx`. */
export type MethodArgs<F> = F extends (ctx: any, ...args: infer A) => any ? A : never;

/** A module function as the instance exposes it: `ctx` already applied. */
type Bound<F> = F extends (ctx: any, ...args: infer A) => infer R ? (...args: A) => R : never;

/**
 * What a method module reads off the service: its collaborators, and its
 * methods dispatched through the instance so a spy or override still sees them.
 */
export interface GoalServiceContext {
  readonly acceptanceService: AcceptanceService;
  addEdge: Bound<typeof addEdge>;
  addNode: Bound<typeof addNode>;
  readonly agentModel: AgentModel;
  answerClarifications: Bound<typeof answerClarifications>;
  answerReleaseGate: GoalReleaseReview['answerReleaseGate'];
  attachTaskDeliverables: Bound<typeof attachTaskDeliverables>;
  bindTopic: Bound<typeof bindTopic>;
  readonly briefs: GoalBriefService;
  buildTaskAcceptanceRequirement: Bound<typeof buildTaskAcceptanceRequirement>;
  buildTaskInstruction: Bound<typeof buildTaskInstruction>;
  close: Bound<typeof close>;
  collectAcceptances: Bound<typeof collectAcceptances>;
  collectAssignees: Bound<typeof collectAssignees>;
  collectDeliveredAt: Bound<typeof collectDeliveredAt>;
  collectQuotaWaits: Bound<typeof collectQuotaWaits>;
  collectRolloutGate: Bound<typeof collectRolloutGate>;
  collectRunHeartbeats: Bound<typeof collectRunHeartbeats>;
  consumeCompletedTask: Bound<typeof consumeCompletedTask>;
  readonly coordinatorGraph: GoalGraphModel;
  create: Bound<typeof create>;
  createFromConversation: Bound<typeof createFromConversation>;
  createResponsibleTask: Bound<typeof createResponsibleTask>;
  readonly db: LobeChatDatabase;
  decide: Bound<typeof decide>;
  delete: Bound<typeof deleteGoal>;
  dispatchGoalReport: Bound<typeof dispatchGoalReport>;
  dispatchWork: Bound<typeof dispatchWork>;
  ensureTaskWorkVersion: Bound<typeof ensureTaskWorkVersion>;
  evaluateBudget: Bound<typeof evaluateBudget>;
  evaluateMetricCriteria: Bound<typeof evaluateMetricCriteria>;
  followGoalAgent: Bound<typeof followGoalAgent>;
  gateOrTakeOver: Bound<typeof gateOrTakeOver>;
  readonly goalModel: GoalModel;
  goalOwnerTaskScope: Bound<typeof goalOwnerTaskScope>;
  graph: Bound<typeof graph>;
  graphAs: Bound<typeof graphAs>;
  readonly graphModel: GoalGraphModel;
  handPlanningToMainAgent: Bound<typeof handPlanningToMainAgent>;
  holdForMachineFailure: Bound<typeof holdForMachineFailure>;
  holdForOfflineDevice: Bound<typeof holdForOfflineDevice>;
  /** The same service, its reads and writes bound to `tx`. */
  inTransaction: (tx: LobeChatDatabase) => GoalServiceContext;
  isBatchMember: Bound<typeof isBatchMember>;
  isParkedOnMeasuredGate: Bound<typeof isParkedOnMeasuredGate>;
  listEvents: Bound<typeof listEvents>;
  markRunLostToOfflineDevice: Bound<typeof markRunLostToOfflineDevice>;
  openFailureDecision: Bound<typeof openFailureDecision>;
  openFailureDecisionLocked: Bound<typeof openFailureDecisionLocked>;
  openPatternBreakGate: Bound<typeof openPatternBreakGate>;
  pause: Bound<typeof pause>;
  pendingClarifications: Bound<typeof pendingClarifications>;
  pendingForIsland: Bound<typeof pendingForIsland>;
  planDecomposition: Bound<typeof planDecomposition>;
  planMachineRecoveryFor: Bound<typeof planMachineRecoveryFor>;
  readRunDevicePresence: Bound<typeof readRunDevicePresence>;
  reassignUnfinishedTasks: Bound<typeof reassignUnfinishedTasks>;
  recordObservation: Bound<typeof recordObservation>;
  recoverAbandonedTask: Bound<typeof recoverAbandonedTask>;
  recoverAfterVerification: Bound<typeof recoverAfterVerification>;
  recoverLostRun: Bound<typeof recoverLostRun>;
  readonly releaseReview: GoalReleaseReview;
  reopenForChanges: Bound<typeof reopenForChanges>;
  reopenIfMeasurementCleared: Bound<typeof reopenIfMeasurementCleared>;
  requestSignOff: Bound<typeof requestSignOff>;
  requireGraph: Bound<typeof requireGraph>;
  resolveSpend: Bound<typeof resolveSpend>;
  resolveTaskAssignee: Bound<typeof resolveTaskAssignee>;
  resolveTopicRun: Bound<typeof resolveTopicRun>;
  restart: Bound<typeof restart>;
  restartRolloutLoop: Bound<typeof restartRolloutLoop>;
  resume: Bound<typeof resume>;
  resumeAbandonedTaskRecovery: Bound<typeof resumeAbandonedTaskRecovery>;
  retireNodes: Bound<typeof retireNodes>;
  setAcceptanceCriteria: Bound<typeof setAcceptanceCriteria>;
  setAgent: Bound<typeof setAgent>;
  setBudget: Bound<typeof setBudget>;
  setMetricCriteria: Bound<typeof setMetricCriteria>;
  setModel: Bound<typeof setModel>;
  setPauseReason: Bound<typeof setPauseReason>;
  setTaskAgent: Bound<typeof setTaskAgent>;
  setTaskModel: Bound<typeof setTaskModel>;
  settleTerminalAcceptance: Bound<typeof settleTerminalAcceptance>;
  status: Bound<typeof status>;
  stopFencedTasks: Bound<typeof stopFencedTasks>;
  readonly taskModel: TaskModel;
  readonly taskService: TaskService;
  readonly taskTopicModel: TaskTopicModel;
  tick: Bound<typeof tick>;
  tickOnce: Bound<typeof tickOnce>;
  transitionStatus: Bound<typeof transitionStatus>;
  updateRequirement: Bound<typeof updateRequirement>;
  updateTitle: Bound<typeof updateTitle>;
  readonly userId: string;
  waitForDevice: Bound<typeof waitForDevice>;
  waitForQuotaReset: Bound<typeof waitForQuotaReset>;
  readonly workModel: WorkModel;
  readonly workspaceId: string | undefined;
}
