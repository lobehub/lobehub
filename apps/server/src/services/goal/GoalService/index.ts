import { GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';

import { AgentModel } from '@/database/models/agent';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { WorkModel } from '@/database/models/work';
import { GoalRepository } from '@/database/repositories/goal';
import type { LobeChatDatabase } from '@/database/type';

import { TaskService } from '../../task';
import { AcceptanceService } from '../../verify/acceptanceService';
import { GoalBriefService } from '../goalBriefs';
import { GoalReleaseReview } from '../releaseReview';
import {
  attachTaskDeliverables,
  consumeCompletedTask,
  recoverAfterVerification,
  settleTerminalAcceptance,
} from './completion';
import { bindTopic, create, createFromConversation, resolveTopicRun } from './creation';
import {
  answerClarifications,
  decide,
  gateOrTakeOver,
  openFailureDecision,
  openFailureDecisionLocked,
  reopenForChanges,
} from './decisions';
import {
  buildTaskAcceptanceRequirement,
  buildTaskInstruction,
  createResponsibleTask,
  dispatchWork,
  ensureTaskWorkVersion,
} from './dispatch';
import {
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
import {
  close,
  deleteGoal,
  pause,
  requestSignOff,
  restart,
  resume,
  transitionStatus,
} from './lifecycle';
import {
  evaluateBudget,
  evaluateMetricCriteria,
  isParkedOnMeasuredGate,
  metricState,
  recordObservation,
  removeMetricCriteria,
  reopenIfMeasurementCleared,
  resolveSpend,
  setAcceptanceCriteria,
  setMetricCriteria,
  setPauseReason,
} from './measurement';
import { handPlanningToMainAgent, planDecomposition } from './planning';
import {
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
import {
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
import {
  collectRolloutGate,
  isBatchMember,
  openPatternBreakGate,
  restartRolloutLoop,
} from './rollout';
import { dispatchGoalReport, tick, tickOnce } from './tick';
import type { GoalServiceContext, MethodArgs } from './types';

export type { CreateGoalGraphInput, CreateGoalNodeInput, CreateGoalTaskInput } from './types';
export { goalTaskAgentId } from './utils';

/**
 * Application service shared by CLI today and Graph UI/schedulers later. The
 * class holds the collaborators and delegates every method to a sibling module
 * in this directory, handing it the `GoalServiceContext` view.
 */
export class GoalService {
  private readonly acceptanceService: AcceptanceService;
  private readonly agentModel: AgentModel;
  /** What the goal tells the person through the inbox: gates, sign-off, findings. */
  private readonly briefs: GoalBriefService;
  private readonly releaseReview: GoalReleaseReview;
  private readonly goalModel: GoalRepository;
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
    this.goalModel = new GoalRepository(db, userId, workspaceId);
    this.releaseReview = new GoalReleaseReview(db, userId, workspaceId, {
      briefs: this.briefs,
      decide: (...args) => this.decide(...args),
      graph: (goalId) => this.graph(goalId),
      requireGraph: (goalId) => this.requireGraph(goalId),
      setPauseReason: (goalId, reason) => this.setPauseReason(goalId, reason),
      transitionStatus: (goal, to, reason) => this.transitionStatus(goal, to, reason),
    });
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
   * The view the method modules get: the collaborators through getters, so a
   * module reads a field when it uses it, and the methods through arrows, so a
   * call still dispatches on the instance.
   */
  private get context(): GoalServiceContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get acceptanceService() {
        return self.acceptanceService;
      },
      addEdge: (...args) => self.addEdge(...args),
      addNode: (...args) => self.addNode(...args),
      get agentModel() {
        return self.agentModel;
      },
      answerClarifications: (...args) => self.answerClarifications(...args),
      answerReleaseGate: (...args) => self.answerReleaseGate(...args),
      attachTaskDeliverables: (...args) => self.attachTaskDeliverables(...args),
      bindTopic: (...args) => self.bindTopic(...args),
      get briefs() {
        return self.briefs;
      },
      buildTaskAcceptanceRequirement: (...args) => self.buildTaskAcceptanceRequirement(...args),
      buildTaskInstruction: (...args) => self.buildTaskInstruction(...args),
      close: (...args) => self.close(...args),
      collectAcceptances: (...args) => self.collectAcceptances(...args),
      collectAssignees: (...args) => self.collectAssignees(...args),
      collectDeliveredAt: (...args) => self.collectDeliveredAt(...args),
      collectQuotaWaits: (...args) => self.collectQuotaWaits(...args),
      collectRolloutGate: (...args) => self.collectRolloutGate(...args),
      collectRunHeartbeats: (...args) => self.collectRunHeartbeats(...args),
      consumeCompletedTask: (...args) => self.consumeCompletedTask(...args),
      get coordinatorGraph() {
        return self.coordinatorGraph;
      },
      create: (...args) => self.create(...args),
      createFromConversation: (...args) => self.createFromConversation(...args),
      createResponsibleTask: (...args) => self.createResponsibleTask(...args),
      get db() {
        return self.db;
      },
      decide: (...args) => self.decide(...args),
      delete: (...args) => self.delete(...args),
      dispatchGoalReport: (...args) => self.dispatchGoalReport(...args),
      dispatchWork: (...args) => self.dispatchWork(...args),
      ensureTaskWorkVersion: (...args) => self.ensureTaskWorkVersion(...args),
      evaluateBudget: (...args) => self.evaluateBudget(...args),
      evaluateMetricCriteria: (...args) => self.evaluateMetricCriteria(...args),
      followGoalAgent: (...args) => self.followGoalAgent(...args),
      gateOrTakeOver: (...args) => self.gateOrTakeOver(...args),
      get goalModel() {
        return self.goalModel;
      },
      goalOwnerTaskScope: (...args) => self.goalOwnerTaskScope(...args),
      graph: (...args) => self.graph(...args),
      graphAs: (...args) => self.graphAs(...args),
      get graphModel() {
        return self.graphModel;
      },
      handPlanningToMainAgent: (...args) => self.handPlanningToMainAgent(...args),
      holdForMachineFailure: (...args) => self.holdForMachineFailure(...args),
      holdForOfflineDevice: (...args) => self.holdForOfflineDevice(...args),
      inTransaction: (tx) => new GoalService(tx, self.userId, self.workspaceId).context,
      isBatchMember: (...args) => self.isBatchMember(...args),
      isParkedOnMeasuredGate: (...args) => self.isParkedOnMeasuredGate(...args),
      listEvents: (...args) => self.listEvents(...args),
      markRunLostToOfflineDevice: (...args) => self.markRunLostToOfflineDevice(...args),
      openFailureDecision: (...args) => self.openFailureDecision(...args),
      openFailureDecisionLocked: (...args) => self.openFailureDecisionLocked(...args),
      openPatternBreakGate: (...args) => self.openPatternBreakGate(...args),
      pause: (...args) => self.pause(...args),
      pendingClarifications: (...args) => self.pendingClarifications(...args),
      pendingForIsland: (...args) => self.pendingForIsland(...args),
      planDecomposition: (...args) => self.planDecomposition(...args),
      planMachineRecoveryFor: (...args) => self.planMachineRecoveryFor(...args),
      readRunDevicePresence: (...args) => self.readRunDevicePresence(...args),
      reassignUnfinishedTasks: (...args) => self.reassignUnfinishedTasks(...args),
      recordObservation: (...args) => self.recordObservation(...args),
      recoverAbandonedTask: (...args) => self.recoverAbandonedTask(...args),
      recoverAfterVerification: (...args) => self.recoverAfterVerification(...args),
      recoverLostRun: (...args) => self.recoverLostRun(...args),
      get releaseReview() {
        return self.releaseReview;
      },
      reopenForChanges: (...args) => self.reopenForChanges(...args),
      reopenIfMeasurementCleared: (...args) => self.reopenIfMeasurementCleared(...args),
      requestSignOff: (...args) => self.requestSignOff(...args),
      requireGraph: (...args) => self.requireGraph(...args),
      resolveSpend: (...args) => self.resolveSpend(...args),
      resolveTaskAssignee: (...args) => self.resolveTaskAssignee(...args),
      resolveTopicRun: (...args) => self.resolveTopicRun(...args),
      restart: (...args) => self.restart(...args),
      restartRolloutLoop: (...args) => self.restartRolloutLoop(...args),
      resume: (...args) => self.resume(...args),
      resumeAbandonedTaskRecovery: (...args) => self.resumeAbandonedTaskRecovery(...args),
      retireNodes: (...args) => self.retireNodes(...args),
      setAcceptanceCriteria: (...args) => self.setAcceptanceCriteria(...args),
      setAgent: (...args) => self.setAgent(...args),
      setBudget: (...args) => self.setBudget(...args),
      setMetricCriteria: (...args) => self.setMetricCriteria(...args),
      setModel: (...args) => self.setModel(...args),
      setPauseReason: (...args) => self.setPauseReason(...args),
      setTaskAgent: (...args) => self.setTaskAgent(...args),
      setTaskModel: (...args) => self.setTaskModel(...args),
      settleTerminalAcceptance: (...args) => self.settleTerminalAcceptance(...args),
      status: (...args) => self.status(...args),
      stopFencedTasks: (...args) => self.stopFencedTasks(...args),
      get taskModel() {
        return self.taskModel;
      },
      get taskService() {
        return self.taskService;
      },
      get taskTopicModel() {
        return self.taskTopicModel;
      },
      tick: (...args) => self.tick(...args),
      tickOnce: (...args) => self.tickOnce(...args),
      transitionStatus: (...args) => self.transitionStatus(...args),
      updateRequirement: (...args) => self.updateRequirement(...args),
      updateTitle: (...args) => self.updateTitle(...args),
      get userId() {
        return self.userId;
      },
      waitForDevice: (...args) => self.waitForDevice(...args),
      waitForQuotaReset: (...args) => self.waitForQuotaReset(...args),
      get workModel() {
        return self.workModel;
      },
      get workspaceId() {
        return self.workspaceId;
      },
    };
  }

  private graphAs = (...args: MethodArgs<typeof graphAs>) => graphAs(this.context, ...args);

  createFromConversation = (...args: MethodArgs<typeof createFromConversation>) =>
    createFromConversation(this.context, ...args);

  private resolveTopicRun = (...args: MethodArgs<typeof resolveTopicRun>) =>
    resolveTopicRun(this.context, ...args);

  bindTopic = (...args: MethodArgs<typeof bindTopic>) => bindTopic(this.context, ...args);

  create = (...args: MethodArgs<typeof create>) => create(this.context, ...args);

  recordObservation = (...args: MethodArgs<typeof recordObservation>) =>
    recordObservation(this.context, ...args);

  private reopenIfMeasurementCleared = (...args: MethodArgs<typeof reopenIfMeasurementCleared>) =>
    reopenIfMeasurementCleared(this.context, ...args);

  private setPauseReason = (...args: MethodArgs<typeof setPauseReason>) =>
    setPauseReason(this.context, ...args);

  private isParkedOnMeasuredGate = (...args: MethodArgs<typeof isParkedOnMeasuredGate>) =>
    isParkedOnMeasuredGate(this.context, ...args);

  setMetricCriteria = (...args: MethodArgs<typeof setMetricCriteria>) =>
    setMetricCriteria(this.context, ...args);

  removeMetricCriteria = (...args: MethodArgs<typeof removeMetricCriteria>) =>
    removeMetricCriteria(this.context, ...args);

  metricState = (...args: MethodArgs<typeof metricState>) => metricState(this.context, ...args);

  setAcceptanceCriteria = (...args: MethodArgs<typeof setAcceptanceCriteria>) =>
    setAcceptanceCriteria(this.context, ...args);

  graph = (...args: MethodArgs<typeof graph>) => graph(this.context, ...args);

  listEvents = (...args: MethodArgs<typeof listEvents>) => listEvents(this.context, ...args);

  private collectAssignees = (...args: MethodArgs<typeof collectAssignees>) =>
    collectAssignees(this.context, ...args);

  private requestSignOff = (...args: MethodArgs<typeof requestSignOff>) =>
    requestSignOff(this.context, ...args);

  private collectAcceptances = (...args: MethodArgs<typeof collectAcceptances>) =>
    collectAcceptances(this.context, ...args);

  private collectDeliveredAt = (...args: MethodArgs<typeof collectDeliveredAt>) =>
    collectDeliveredAt(this.context, ...args);

  private collectQuotaWaits = (...args: MethodArgs<typeof collectQuotaWaits>) =>
    collectQuotaWaits(this.context, ...args);

  private collectRunHeartbeats = (...args: MethodArgs<typeof collectRunHeartbeats>) =>
    collectRunHeartbeats(this.context, ...args);

  status = (...args: MethodArgs<typeof status>) => status(this.context, ...args);

  addNode = (...args: MethodArgs<typeof addNode>) => addNode(this.context, ...args);

  addEdge = (...args: MethodArgs<typeof addEdge>) => addEdge(this.context, ...args);

  delete = (...args: MethodArgs<typeof deleteGoal>) => deleteGoal(this.context, ...args);

  private transitionStatus = (...args: MethodArgs<typeof transitionStatus>) =>
    transitionStatus(this.context, ...args);

  pause = (...args: MethodArgs<typeof pause>) => pause(this.context, ...args);

  private evaluateMetricCriteria = (...args: MethodArgs<typeof evaluateMetricCriteria>) =>
    evaluateMetricCriteria(this.context, ...args);

  private evaluateBudget = (...args: MethodArgs<typeof evaluateBudget>) =>
    evaluateBudget(this.context, ...args);

  private resolveSpend = (...args: MethodArgs<typeof resolveSpend>) =>
    resolveSpend(this.context, ...args);

  updateRequirement = (...args: MethodArgs<typeof updateRequirement>) =>
    updateRequirement(this.context, ...args);

  updateTitle = (...args: MethodArgs<typeof updateTitle>) => updateTitle(this.context, ...args);

  setAgent = (...args: MethodArgs<typeof setAgent>) => setAgent(this.context, ...args);

  private followGoalAgent = (...args: MethodArgs<typeof followGoalAgent>) =>
    followGoalAgent(this.context, ...args);

  setTaskAgent = (...args: MethodArgs<typeof setTaskAgent>) => setTaskAgent(this.context, ...args);

  setModel = (...args: MethodArgs<typeof setModel>) => setModel(this.context, ...args);

  setTaskModel = (...args: MethodArgs<typeof setTaskModel>) => setTaskModel(this.context, ...args);

  private resolveTaskAssignee = (...args: MethodArgs<typeof resolveTaskAssignee>) =>
    resolveTaskAssignee(this.context, ...args);

  private reassignUnfinishedTasks = (...args: MethodArgs<typeof reassignUnfinishedTasks>) =>
    reassignUnfinishedTasks(this.context, ...args);

  restart = (...args: MethodArgs<typeof restart>) => restart(this.context, ...args);

  private goalOwnerTaskScope = (...args: MethodArgs<typeof goalOwnerTaskScope>) =>
    goalOwnerTaskScope(this.context, ...args);

  private stopFencedTasks = (...args: MethodArgs<typeof stopFencedTasks>) =>
    stopFencedTasks(this.context, ...args);

  retireNodes = (...args: MethodArgs<typeof retireNodes>) => retireNodes(this.context, ...args);

  setBudget = (...args: MethodArgs<typeof setBudget>) => setBudget(this.context, ...args);

  resume = (...args: MethodArgs<typeof resume>) => resume(this.context, ...args);

  close = (...args: MethodArgs<typeof close>) => close(this.context, ...args);

  decide = (...args: MethodArgs<typeof decide>) => decide(this.context, ...args);

  reopenForChanges = (...args: MethodArgs<typeof reopenForChanges>) =>
    reopenForChanges(this.context, ...args);

  answerClarifications = (...args: MethodArgs<typeof answerClarifications>) =>
    answerClarifications(this.context, ...args);

  pendingForIsland = (...args: MethodArgs<typeof pendingForIsland>) =>
    pendingForIsland(this.context, ...args);

  pendingClarifications = (...args: MethodArgs<typeof pendingClarifications>) =>
    pendingClarifications(this.context, ...args);

  tick = (...args: MethodArgs<typeof tick>) => tick(this.context, ...args);

  private dispatchGoalReport = (...args: MethodArgs<typeof dispatchGoalReport>) =>
    dispatchGoalReport(this.context, ...args);

  private tickOnce = (...args: MethodArgs<typeof tickOnce>) => tickOnce(this.context, ...args);

  private settleTerminalAcceptance = (...args: MethodArgs<typeof settleTerminalAcceptance>) =>
    settleTerminalAcceptance(this.context, ...args);

  private createResponsibleTask = (...args: MethodArgs<typeof createResponsibleTask>) =>
    createResponsibleTask(this.context, ...args);

  private recoverAfterVerification = (...args: MethodArgs<typeof recoverAfterVerification>) =>
    recoverAfterVerification(this.context, ...args);

  private dispatchWork = (...args: MethodArgs<typeof dispatchWork>) =>
    dispatchWork(this.context, ...args);

  private requireGraph = (...args: MethodArgs<typeof requireGraph>) =>
    requireGraph(this.context, ...args);

  private ensureTaskWorkVersion = (...args: MethodArgs<typeof ensureTaskWorkVersion>) =>
    ensureTaskWorkVersion(this.context, ...args);

  private recoverAbandonedTask = (...args: MethodArgs<typeof recoverAbandonedTask>) =>
    recoverAbandonedTask(this.context, ...args);

  private recoverLostRun = (...args: MethodArgs<typeof recoverLostRun>) =>
    recoverLostRun(this.context, ...args);

  private markRunLostToOfflineDevice = (...args: MethodArgs<typeof markRunLostToOfflineDevice>) =>
    markRunLostToOfflineDevice(this.context, ...args);

  private resumeAbandonedTaskRecovery = (...args: MethodArgs<typeof resumeAbandonedTaskRecovery>) =>
    resumeAbandonedTaskRecovery(this.context, ...args);

  private planMachineRecoveryFor = (...args: MethodArgs<typeof planMachineRecoveryFor>) =>
    planMachineRecoveryFor(this.context, ...args);

  private holdForMachineFailure = (...args: MethodArgs<typeof holdForMachineFailure>) =>
    holdForMachineFailure(this.context, ...args);

  private waitForDevice = (...args: MethodArgs<typeof waitForDevice>) =>
    waitForDevice(this.context, ...args);

  private waitForQuotaReset = (...args: MethodArgs<typeof waitForQuotaReset>) =>
    waitForQuotaReset(this.context, ...args);

  private holdForOfflineDevice = (...args: MethodArgs<typeof holdForOfflineDevice>) =>
    holdForOfflineDevice(this.context, ...args);

  private readRunDevicePresence = (...args: MethodArgs<typeof readRunDevicePresence>) =>
    readRunDevicePresence(this.context, ...args);

  private buildTaskInstruction = (...args: MethodArgs<typeof buildTaskInstruction>) =>
    buildTaskInstruction(this.context, ...args);

  private planDecomposition = (...args: MethodArgs<typeof planDecomposition>) =>
    planDecomposition(this.context, ...args);

  private handPlanningToMainAgent = (...args: MethodArgs<typeof handPlanningToMainAgent>) =>
    handPlanningToMainAgent(this.context, ...args);

  private collectRolloutGate = (...args: MethodArgs<typeof collectRolloutGate>) =>
    collectRolloutGate(this.context, ...args);

  private isBatchMember = (...args: MethodArgs<typeof isBatchMember>) =>
    isBatchMember(this.context, ...args);

  /** Answer a held release from its review report; see {@link GoalReleaseReview.answerReleaseGate}. */
  answerReleaseGate: GoalReleaseReview['answerReleaseGate'] = (...args) =>
    this.releaseReview.answerReleaseGate(...args);

  private openPatternBreakGate = (...args: MethodArgs<typeof openPatternBreakGate>) =>
    openPatternBreakGate(this.context, ...args);

  private restartRolloutLoop = (...args: MethodArgs<typeof restartRolloutLoop>) =>
    restartRolloutLoop(this.context, ...args);

  private buildTaskAcceptanceRequirement = (
    ...args: MethodArgs<typeof buildTaskAcceptanceRequirement>
  ) => buildTaskAcceptanceRequirement(this.context, ...args);

  private attachTaskDeliverables = (...args: MethodArgs<typeof attachTaskDeliverables>) =>
    attachTaskDeliverables(this.context, ...args);

  private consumeCompletedTask = (...args: MethodArgs<typeof consumeCompletedTask>) =>
    consumeCompletedTask(this.context, ...args);

  private gateOrTakeOver = (...args: MethodArgs<typeof gateOrTakeOver>) =>
    gateOrTakeOver(this.context, ...args);

  private openFailureDecision = (...args: MethodArgs<typeof openFailureDecision>) =>
    openFailureDecision(this.context, ...args);

  private openFailureDecisionLocked = (...args: MethodArgs<typeof openFailureDecisionLocked>) =>
    openFailureDecisionLocked(this.context, ...args);
}
