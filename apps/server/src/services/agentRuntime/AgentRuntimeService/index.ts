import type { Agent, GeneralAgentConfig } from '@lobechat/agent-runtime';
import { selectOperationToolSet } from '@lobechat/agent-runtime';
import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import type { LobeAgentConfig } from '@lobechat/types';
import debug from 'debug';
import urlJoin from 'url-join';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { AgentRuntimeCoordinator, createStreamEventManager } from '@/server/modules/AgentRuntime';
import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { mcpService } from '@/server/services/mcp';
import type { ClientMcpStep } from '@/server/services/mcp/elicitation/clientStep';
import { expireMcpElicitation } from '@/server/services/mcp/elicitation/expire';
import { McpElicitationService } from '@/server/services/mcp/elicitation/McpElicitationService';
import type { McpElicitationRuntime } from '@/server/services/mcp/elicitation/resume';
import { MessageService } from '@/server/services/message';
import { QueueService } from '@/server/services/queue';
import { ToolExecutionService } from '@/server/services/toolExecution';
import { BuiltinToolsExecutor } from '@/server/services/toolExecution/builtin';

import { CompletionLifecycle } from '../CompletionLifecycle';
import { HumanInterventionHandler } from '../HumanInterventionHandler';
import { OperationTraceRecorder } from '../OperationTraceRecorder';
import { createDefaultSnapshotStore } from '../snapshotStore';
import {
  allPendingToolsFulfilled,
  maybeScheduleAsyncToolVerify,
  resolveAsyncToolOnComplete,
  tryResumeParentFromAsyncTool,
} from './asyncTool';
import {
  endExpiredClientLlmWait,
  expireClientLlmWait,
  finishClientLlmWaitExpiry,
  listClientLlmWaits,
  parkForClientLlm,
  restoreClientLlmWait,
  resumeFromClientLlmWait,
  revertClientWaitResumeWithRetry,
  updateAssistantRowWithRetry,
} from './clientLlmWait';
import { createOperation } from './createOperation';
import { executeStep } from './executeStep/index';
import { executeSync } from './executeSync';
import {
  completeGroupActionMember,
  completeGroupMemberBarrier,
  countFulfilledMemberAnchors,
  handleGroupMemberTimeout,
  loadGroupMemberBridge,
  scheduleGroupMemberTimeout,
} from './groupMember';
import {
  ensureInterventionContinuationStarted,
  getPendingInterventions,
  loadInterventionContinuationState,
  persistInterventionDispatchAck,
  processHumanIntervention,
  recordInterventionLifecycleCompletion,
  shouldReplayPendingInterventionLifecycle,
} from './intervention';
import {
  queryMessagesFromDB,
  queryStepEntryMessages,
  queryUiMessages,
  refreshMessagesFromDB,
  resolveAsyncToolResumeParentMessageId,
  resolveLastAssistantContentFromThread,
  resolveLastAssistantMessageFromDB,
  usesGatewayMessagePatch,
} from './messages';
import {
  acceptsFileWorks,
  acceptsMemberRuntimeEnd,
  controlCompletedToolResult,
  getOperationEditingGroupId,
  getOperationStatus,
  injectQueuedFollowUp,
  interruptOperation,
  isOperationInterrupted,
  readQueuedMessagesFlag,
  releaseOperationLock,
  scheduleContinuation,
  setQueuedMessages,
  startExecution,
  startStepLockHeartbeat,
} from './operationControl';
import {
  computeDeviceContext,
  createAgentRuntime,
  getLlmExecutor,
  resolveLlmExecutor,
  setupLocalExecutionCallback,
} from './runtimeFactory';
import { buildShareAbortResult } from './shareRunGate';
import {
  calculatePriority,
  calculateStepDelay,
  determineCompletionReason,
  shouldContinueExecution,
} from './stepPolicy';
import {
  completeSubAgentBridge,
  isCallSubAgentToolMessage,
  publishSubAgentProgress,
} from './subAgentBridge';
import type {
  AgentRuntimeDelegate,
  AgentRuntimeServiceContext,
  AgentRuntimeServiceOptions,
  MethodArgs,
} from './types';
import { createStepLockOwner } from './utils';

if (process.env.VERCEL) {
  // Route debug output to stdout (`console.info`) instead of stderr, which
  // Vercel would otherwise surface as error-level logs.
  debug.log = console.info.bind(console);
}

export { createEvalToolForwardingHook } from './evalToolForwardingHook';
export type { AgentRuntimeDelegate, AgentRuntimeServiceOptions } from './types';

/**
 * The step executor and its operation lifecycle. The class holds the
 * collaborators and delegates every method to a sibling module, handing it the
 * narrow `AgentRuntimeServiceContext` view it declares; calls still dispatch
 * through the instance, so the methods stay overridable and spy-able.
 */
export class AgentRuntimeService {
  private readonly agentOperationModel: AgentOperationModel;
  private readonly agentFactory?: (config: GeneralAgentConfig) => Agent;
  private readonly completionLifecycle: CompletionLifecycle;
  private readonly coordinator: AgentRuntimeCoordinator;
  private readonly delegate: AgentRuntimeDelegate;
  private readonly humanIntervention: HumanInterventionHandler;
  private readonly streamManager: IStreamEventManager;
  private readonly queueService: QueueService | null;
  private readonly traceRecorder: OperationTraceRecorder;
  private readonly toolExecutionService: ToolExecutionService;
  private get baseURL() {
    const baseUrl = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';

    return urlJoin(baseUrl, '/api/agent');
  }
  private readonly serverDB: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;
  private readonly messageModel: MessageModel;
  // Lazily constructed because MessageService instantiates a FileService
  // which eagerly creates the S3 client and throws when S3 env vars are
  // missing — eager construction would break every test that builds an
  // AgentRuntimeService without mocking the file backend.
  private messageServiceInstance?: MessageService;
  private get messageService(): MessageService {
    if (!this.messageServiceInstance) {
      this.messageServiceInstance = new MessageService(
        this.serverDB,
        this.userId,
        this.workspaceId,
      );
    }
    return this.messageServiceInstance;
  }

  constructor(db: LobeChatDatabase, userId: string, options?: AgentRuntimeServiceOptions) {
    // Use factory function to auto-select Redis or InMemory implementation.
    // Gateway pushes are deferred off the step path: every point where this
    // invocation can stop or hand the run over calls `drainPushes` first.
    this.streamManager =
      options?.streamEventManager ??
      options?.coordinatorOptions?.streamEventManager ??
      createStreamEventManager({ deferPushes: true });
    this.coordinator = new AgentRuntimeCoordinator({
      ...options?.coordinatorOptions,
      messagePatchModeResolver: (state) => this.usesGatewayMessagePatch(state),
      streamEventManager: this.streamManager,
      // Provide the canonical UIChatMessage[] for terminal-state events so
      // the client can use the pushed payload directly instead of refetching
      // from DB. Falls back gracefully when topicId isn't set.
      uiMessagesResolver: async (state) =>
        this.usesGatewayMessagePatch(state) ? undefined : this.queryUiMessages(state),
    });
    this.queueService =
      options?.queueService === null ? null : (options?.queueService ?? new QueueService());
    this.traceRecorder = new OperationTraceRecorder(
      options?.snapshotStore ?? createDefaultSnapshotStore(),
    );
    this.agentFactory = options?.agentFactory;
    this.delegate = options?.delegate ?? {};
    this.serverDB = db;
    this.userId = userId;
    this.workspaceId = options?.workspaceId;
    const workspaceId = this.workspaceId;
    const includeShareVisitor = options?.includeShareVisitor ?? false;
    this.agentOperationModel = new AgentOperationModel(db, this.userId, workspaceId);
    this.messageModel = new MessageModel(db, this.userId, workspaceId, undefined, {
      includeShareVisitor,
    });
    this.completionLifecycle = new CompletionLifecycle(db, userId, workspaceId, {
      includeShareVisitor,
      onTopicRunSettled: ({ operationId, topicId }) =>
        this.delegate.deliverBackgroundSubAgentResults?.({
          settledOperationId: operationId,
          topicId,
        }) ?? Promise.resolve(),
    });
    this.humanIntervention = new HumanInterventionHandler(db, this.messageModel);

    // Initialize ToolExecutionService with dependencies
    const builtinToolsExecutor = new BuiltinToolsExecutor(db, userId);

    this.toolExecutionService = new ToolExecutionService({
      builtinToolsExecutor,
      mcpService,
      onMcpElicitationExpired: (service, itemId) =>
        expireMcpElicitation(service, itemId, this.getMcpElicitationRuntime()),
      mcpRuntime: this.getMcpElicitationRuntime(),
    });

    // Setup local execution callback for LocalQueueServiceImpl
    this.setupLocalExecutionCallback();
  }

  // ==================== Operation Interruption ====================
  getMcpElicitationRuntime(): McpElicitationRuntime {
    return {
      executeTool: (...args) => this.toolExecutionService.executeTool(...args),
      isOperationInterrupted: (id) => this.isOperationInterrupted(id),
      getToolResultPolicy: async (id) => {
        const operation = await new AgentOperationModel(
          this.serverDB,
          this.userId,
          this.workspaceId,
        ).findById(id);
        const clientStep = operation?.metadata?.clientMcpStep as ClientMcpStep | undefined;
        if (clientStep?.resultPolicy) return clientStep.resultPolicy;
        const state = await this.coordinator.loadAgentState(id);
        return {
          limit: (state?.world?.agent as LobeAgentConfig | undefined)?.chatConfig
            ?.toolResultMaxLength,
          canReadArchive:
            !!state &&
            selectOperationToolSet(state).enabledToolIds.includes(AgentDocumentsIdentifier),
        };
      },
      controlCompletedToolResult: (...args) => this.controlCompletedToolResult(...args),
      tryResumeParentFromAsyncTool: async (...args) => {
        const operation = await new AgentOperationModel(
          this.serverDB,
          this.userId,
          this.workspaceId,
        ).findById(args[0].parentOperationId!);
        if (operation?.metadata?.clientMcpStep) return false;
        return this.tryResumeParentFromAsyncTool(...args);
      },
    };
  }

  createMcpElicitationService() {
    return new McpElicitationService(
      this.serverDB,
      this.userId,
      this.workspaceId,
      (service, itemId) => expireMcpElicitation(service, itemId, this.getMcpElicitationRuntime()),
      this.getMcpElicitationRuntime(),
    );
  }

  // ==================== Operation Management ====================

  /**
   * Mint a lock owner for an inline step loop. Unique per invocation, which is
   * what makes re-entering the same lock on the next step safe.
   */
  createOperationLockOwner(operationId: string): string {
    return createStepLockOwner(operationId, 0);
  }

  // ==================== Waiting for a client (U4c) ====================

  /**
   * Get Coordinator instance (for testing)
   */
  getCoordinator(): AgentRuntimeCoordinator {
    return this.coordinator;
  }

  /**
   * The view the sibling modules get: the collaborators through getters, so a
   * module reads a field when it uses it (as a method body did), and the
   * methods through arrows, so a call still dispatches on the instance.
   */
  private get context(): AgentRuntimeServiceContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get agentOperationModel() {
        return self.agentOperationModel;
      },
      get agentFactory() {
        return self.agentFactory;
      },
      get completionLifecycle() {
        return self.completionLifecycle;
      },
      get coordinator() {
        return self.coordinator;
      },
      get delegate() {
        return self.delegate;
      },
      get humanIntervention() {
        return self.humanIntervention;
      },
      get streamManager() {
        return self.streamManager;
      },
      get queueService() {
        return self.queueService;
      },
      get traceRecorder() {
        return self.traceRecorder;
      },
      get toolExecutionService() {
        return self.toolExecutionService;
      },
      get baseURL() {
        return self.baseURL;
      },
      get serverDB() {
        return self.serverDB;
      },
      get userId() {
        return self.userId;
      },
      get workspaceId() {
        return self.workspaceId;
      },
      get messageModel() {
        return self.messageModel;
      },
      get messageService() {
        return self.messageService;
      },
      acceptsFileWorks: (...args) => self.acceptsFileWorks(...args),
      acceptsMemberRuntimeEnd: (...args) => self.acceptsMemberRuntimeEnd(...args),
      allPendingToolsFulfilled: (...args) => self.allPendingToolsFulfilled(...args),
      buildShareAbortResult: (...args) => self.buildShareAbortResult(...args),
      calculatePriority: (...args) => self.calculatePriority(...args),
      calculateStepDelay: (...args) => self.calculateStepDelay(...args),
      completeGroupActionMember: (...args) => self.completeGroupActionMember(...args),
      completeGroupMemberBarrier: (...args) => self.completeGroupMemberBarrier(...args),
      completeSubAgentBridge: (...args) => self.completeSubAgentBridge(...args),
      computeDeviceContext: (...args) => self.computeDeviceContext(...args),
      controlCompletedToolResult: (...args) => self.controlCompletedToolResult(...args),
      countFulfilledMemberAnchors: (...args) => self.countFulfilledMemberAnchors(...args),
      createAgentRuntime: (...args) => self.createAgentRuntime(...args),
      createOperation: (...args) => self.createOperation(...args),
      determineCompletionReason: (...args) => self.determineCompletionReason(...args),
      endExpiredClientLlmWait: (...args) => self.endExpiredClientLlmWait(...args),
      ensureInterventionContinuationStarted: (...args) =>
        self.ensureInterventionContinuationStarted(...args),
      executeStep: (...args) => self.executeStep(...args),
      executeSync: (...args) => self.executeSync(...args),
      expireClientLlmWait: (...args) => self.expireClientLlmWait(...args),
      finishClientLlmWaitExpiry: (...args) => self.finishClientLlmWaitExpiry(...args),
      getLlmExecutor: (...args) => self.getLlmExecutor(...args),
      getOperationStatus: (...args) => self.getOperationStatus(...args),
      getPendingInterventions: (...args) => self.getPendingInterventions(...args),
      handleGroupMemberTimeout: (...args) => self.handleGroupMemberTimeout(...args),
      interruptOperation: (...args) => self.interruptOperation(...args),
      isCallSubAgentToolMessage: (...args) => self.isCallSubAgentToolMessage(...args),
      isOperationInterrupted: (...args) => self.isOperationInterrupted(...args),
      listClientLlmWaits: (...args) => self.listClientLlmWaits(...args),
      loadGroupMemberBridge: (...args) => self.loadGroupMemberBridge(...args),
      loadInterventionContinuationState: (...args) =>
        self.loadInterventionContinuationState(...args),
      maybeScheduleAsyncToolVerify: (...args) => self.maybeScheduleAsyncToolVerify(...args),
      parkForClientLlm: (...args) => self.parkForClientLlm(...args),
      persistInterventionDispatchAck: (...args) => self.persistInterventionDispatchAck(...args),
      processHumanIntervention: (...args) => self.processHumanIntervention(...args),
      publishSubAgentProgress: (...args) => self.publishSubAgentProgress(...args),
      queryMessagesFromDB: (...args) => self.queryMessagesFromDB(...args),
      queryStepEntryMessages: (...args) => self.queryStepEntryMessages(...args),
      queryUiMessages: (...args) => self.queryUiMessages(...args),
      injectQueuedFollowUp: (...args) => self.injectQueuedFollowUp(...args),
      readQueuedMessagesFlag: (...args) => self.readQueuedMessagesFlag(...args),
      recordInterventionLifecycleCompletion: (...args) =>
        self.recordInterventionLifecycleCompletion(...args),
      refreshMessagesFromDB: (...args) => self.refreshMessagesFromDB(...args),
      releaseOperationLock: (...args) => self.releaseOperationLock(...args),
      resolveAsyncToolOnComplete: (...args) => self.resolveAsyncToolOnComplete(...args),
      resolveAsyncToolResumeParentMessageId: (...args) =>
        self.resolveAsyncToolResumeParentMessageId(...args),
      resolveLastAssistantContentFromThread: (...args) =>
        self.resolveLastAssistantContentFromThread(...args),
      resolveLastAssistantMessageFromDB: (...args) =>
        self.resolveLastAssistantMessageFromDB(...args),
      resolveLlmExecutor: (...args) => self.resolveLlmExecutor(...args),
      restoreClientLlmWait: (...args) => self.restoreClientLlmWait(...args),
      resumeFromClientLlmWait: (...args) => self.resumeFromClientLlmWait(...args),
      revertClientWaitResumeWithRetry: (...args) => self.revertClientWaitResumeWithRetry(...args),
      scheduleContinuation: (...args) => self.scheduleContinuation(...args),
      scheduleGroupMemberTimeout: (...args) => self.scheduleGroupMemberTimeout(...args),
      setQueuedMessages: (...args) => self.setQueuedMessages(...args),
      setupLocalExecutionCallback: (...args) => self.setupLocalExecutionCallback(...args),
      shouldContinueExecution: (...args) => self.shouldContinueExecution(...args),
      shouldReplayPendingInterventionLifecycle: (...args) =>
        self.shouldReplayPendingInterventionLifecycle(...args),
      startExecution: (...args) => self.startExecution(...args),
      startStepLockHeartbeat: (...args) => self.startStepLockHeartbeat(...args),
      tryResumeParentFromAsyncTool: (...args) => self.tryResumeParentFromAsyncTool(...args),
      updateAssistantRowWithRetry: (...args) => self.updateAssistantRowWithRetry(...args),
      usesGatewayMessagePatch: (...args) => self.usesGatewayMessagePatch(...args),
    };
  }

  // ==================== Delegates to the sibling modules ====================
  private startStepLockHeartbeat(...args: MethodArgs<typeof startStepLockHeartbeat>) {
    return startStepLockHeartbeat(this.context, ...args);
  }

  isOperationInterrupted(...args: MethodArgs<typeof isOperationInterrupted>) {
    return isOperationInterrupted(this.context, ...args);
  }

  interruptOperation(...args: MethodArgs<typeof interruptOperation>) {
    return interruptOperation(this.context, ...args);
  }

  acceptsFileWorks(...args: MethodArgs<typeof acceptsFileWorks>) {
    return acceptsFileWorks(this.context, ...args);
  }

  acceptsMemberRuntimeEnd(...args: MethodArgs<typeof acceptsMemberRuntimeEnd>) {
    return acceptsMemberRuntimeEnd(this.context, ...args);
  }

  getOperationEditingGroupId(...args: MethodArgs<typeof getOperationEditingGroupId>) {
    return getOperationEditingGroupId(this.context, ...args);
  }

  setQueuedMessages(...args: MethodArgs<typeof setQueuedMessages>) {
    return setQueuedMessages(this.context, ...args);
  }

  private injectQueuedFollowUp(...args: MethodArgs<typeof injectQueuedFollowUp>) {
    return injectQueuedFollowUp(this.context, ...args);
  }

  private readQueuedMessagesFlag(...args: MethodArgs<typeof readQueuedMessagesFlag>) {
    return readQueuedMessagesFlag(this.context, ...args);
  }

  controlCompletedToolResult(...args: MethodArgs<typeof controlCompletedToolResult>) {
    return controlCompletedToolResult(this.context, ...args);
  }

  scheduleContinuation(...args: MethodArgs<typeof scheduleContinuation>) {
    return scheduleContinuation(this.context, ...args);
  }

  releaseOperationLock(...args: MethodArgs<typeof releaseOperationLock>) {
    return releaseOperationLock(this.context, ...args);
  }

  getOperationStatus(...args: MethodArgs<typeof getOperationStatus>) {
    return getOperationStatus(this.context, ...args);
  }

  startExecution(...args: MethodArgs<typeof startExecution>) {
    return startExecution(this.context, ...args);
  }

  loadInterventionContinuationState(...args: MethodArgs<typeof loadInterventionContinuationState>) {
    return loadInterventionContinuationState(this.context, ...args);
  }

  ensureInterventionContinuationStarted(
    ...args: MethodArgs<typeof ensureInterventionContinuationStarted>
  ) {
    return ensureInterventionContinuationStarted(this.context, ...args);
  }

  private persistInterventionDispatchAck(
    ...args: MethodArgs<typeof persistInterventionDispatchAck>
  ) {
    return persistInterventionDispatchAck(this.context, ...args);
  }

  getPendingInterventions(...args: MethodArgs<typeof getPendingInterventions>) {
    return getPendingInterventions(this.context, ...args);
  }

  processHumanIntervention(...args: MethodArgs<typeof processHumanIntervention>) {
    return processHumanIntervention(this.context, ...args);
  }

  private shouldReplayPendingInterventionLifecycle(
    ...args: Parameters<typeof shouldReplayPendingInterventionLifecycle>
  ) {
    return shouldReplayPendingInterventionLifecycle(...args);
  }

  private recordInterventionLifecycleCompletion(
    ...args: MethodArgs<typeof recordInterventionLifecycleCompletion>
  ) {
    return recordInterventionLifecycleCompletion(this.context, ...args);
  }

  private buildShareAbortResult(...args: MethodArgs<typeof buildShareAbortResult>) {
    return buildShareAbortResult(this.context, ...args);
  }

  createOperation(...args: MethodArgs<typeof createOperation>) {
    return createOperation(this.context, ...args);
  }

  queryUiMessages(...args: MethodArgs<typeof queryUiMessages>) {
    return queryUiMessages(this.context, ...args);
  }

  private usesGatewayMessagePatch(...args: Parameters<typeof usesGatewayMessagePatch>) {
    return usesGatewayMessagePatch(...args);
  }

  private queryMessagesFromDB(...args: MethodArgs<typeof queryMessagesFromDB>) {
    return queryMessagesFromDB(this.context, ...args);
  }

  private refreshMessagesFromDB(...args: MethodArgs<typeof refreshMessagesFromDB>) {
    return refreshMessagesFromDB(this.context, ...args);
  }

  private resolveLastAssistantMessageFromDB(
    ...args: MethodArgs<typeof resolveLastAssistantMessageFromDB>
  ) {
    return resolveLastAssistantMessageFromDB(this.context, ...args);
  }

  private resolveLastAssistantContentFromThread(
    ...args: MethodArgs<typeof resolveLastAssistantContentFromThread>
  ) {
    return resolveLastAssistantContentFromThread(this.context, ...args);
  }

  private queryStepEntryMessages(...args: MethodArgs<typeof queryStepEntryMessages>) {
    return queryStepEntryMessages(this.context, ...args);
  }

  private resolveAsyncToolResumeParentMessageId(
    ...args: Parameters<typeof resolveAsyncToolResumeParentMessageId>
  ) {
    return resolveAsyncToolResumeParentMessageId(...args);
  }

  executeStep(...args: MethodArgs<typeof executeStep>) {
    return executeStep(this.context, ...args);
  }

  tryResumeParentFromAsyncTool(...args: MethodArgs<typeof tryResumeParentFromAsyncTool>) {
    return tryResumeParentFromAsyncTool(this.context, ...args);
  }

  private maybeScheduleAsyncToolVerify(...args: MethodArgs<typeof maybeScheduleAsyncToolVerify>) {
    return maybeScheduleAsyncToolVerify(this.context, ...args);
  }

  private allPendingToolsFulfilled(...args: MethodArgs<typeof allPendingToolsFulfilled>) {
    return allPendingToolsFulfilled(this.context, ...args);
  }

  private resolveAsyncToolOnComplete(...args: MethodArgs<typeof resolveAsyncToolOnComplete>) {
    return resolveAsyncToolOnComplete(this.context, ...args);
  }

  private parkForClientLlm(...args: MethodArgs<typeof parkForClientLlm>) {
    return parkForClientLlm(this.context, ...args);
  }

  resumeFromClientLlmWait(...args: MethodArgs<typeof resumeFromClientLlmWait>) {
    return resumeFromClientLlmWait(this.context, ...args);
  }

  private restoreClientLlmWait(...args: MethodArgs<typeof restoreClientLlmWait>) {
    return restoreClientLlmWait(this.context, ...args);
  }

  private revertClientWaitResumeWithRetry(
    ...args: MethodArgs<typeof revertClientWaitResumeWithRetry>
  ) {
    return revertClientWaitResumeWithRetry(this.context, ...args);
  }

  listClientLlmWaits(...args: MethodArgs<typeof listClientLlmWaits>) {
    return listClientLlmWaits(this.context, ...args);
  }

  private expireClientLlmWait(...args: MethodArgs<typeof expireClientLlmWait>) {
    return expireClientLlmWait(this.context, ...args);
  }

  private endExpiredClientLlmWait(...args: MethodArgs<typeof endExpiredClientLlmWait>) {
    return endExpiredClientLlmWait(this.context, ...args);
  }

  private updateAssistantRowWithRetry(...args: MethodArgs<typeof updateAssistantRowWithRetry>) {
    return updateAssistantRowWithRetry(this.context, ...args);
  }

  private finishClientLlmWaitExpiry(...args: MethodArgs<typeof finishClientLlmWaitExpiry>) {
    return finishClientLlmWaitExpiry(this.context, ...args);
  }

  private publishSubAgentProgress(...args: MethodArgs<typeof publishSubAgentProgress>) {
    return publishSubAgentProgress(this.context, ...args);
  }

  completeSubAgentBridge(...args: MethodArgs<typeof completeSubAgentBridge>) {
    return completeSubAgentBridge(this.context, ...args);
  }

  private isCallSubAgentToolMessage(...args: MethodArgs<typeof isCallSubAgentToolMessage>) {
    return isCallSubAgentToolMessage(this.context, ...args);
  }

  loadGroupMemberBridge(...args: MethodArgs<typeof loadGroupMemberBridge>) {
    return loadGroupMemberBridge(this.context, ...args);
  }

  private countFulfilledMemberAnchors(...args: MethodArgs<typeof countFulfilledMemberAnchors>) {
    return countFulfilledMemberAnchors(this.context, ...args);
  }

  completeGroupActionMember(...args: MethodArgs<typeof completeGroupActionMember>) {
    return completeGroupActionMember(this.context, ...args);
  }

  completeGroupMemberBarrier(...args: MethodArgs<typeof completeGroupMemberBarrier>) {
    return completeGroupMemberBarrier(this.context, ...args);
  }

  scheduleGroupMemberTimeout(...args: MethodArgs<typeof scheduleGroupMemberTimeout>) {
    return scheduleGroupMemberTimeout(this.context, ...args);
  }

  private handleGroupMemberTimeout(...args: MethodArgs<typeof handleGroupMemberTimeout>) {
    return handleGroupMemberTimeout(this.context, ...args);
  }

  private setupLocalExecutionCallback(...args: MethodArgs<typeof setupLocalExecutionCallback>) {
    return setupLocalExecutionCallback(this.context, ...args);
  }

  private resolveLlmExecutor(...args: MethodArgs<typeof resolveLlmExecutor>) {
    return resolveLlmExecutor(this.context, ...args);
  }

  getLlmExecutor(...args: MethodArgs<typeof getLlmExecutor>) {
    return getLlmExecutor(this.context, ...args);
  }

  private createAgentRuntime(...args: MethodArgs<typeof createAgentRuntime>) {
    return createAgentRuntime(this.context, ...args);
  }

  private computeDeviceContext(...args: MethodArgs<typeof computeDeviceContext>) {
    return computeDeviceContext(this.context, ...args);
  }

  private shouldContinueExecution(...args: Parameters<typeof shouldContinueExecution>) {
    return shouldContinueExecution(...args);
  }

  private calculateStepDelay(...args: Parameters<typeof calculateStepDelay>) {
    return calculateStepDelay(...args);
  }

  private calculatePriority(...args: Parameters<typeof calculatePriority>) {
    return calculatePriority(...args);
  }

  private determineCompletionReason(...args: Parameters<typeof determineCompletionReason>) {
    return determineCompletionReason(...args);
  }

  executeSync(...args: MethodArgs<typeof executeSync>) {
    return executeSync(this.context, ...args);
  }
}
