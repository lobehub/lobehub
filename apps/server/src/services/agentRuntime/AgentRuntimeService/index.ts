import type { Agent, GeneralAgentConfig } from '@lobechat/agent-runtime';
import debug from 'debug';
import urlJoin from 'url-join';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { AgentRuntimeCoordinator, createStreamEventManager } from '@/server/modules/AgentRuntime';
import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { mcpService } from '@/server/services/mcp';
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
  getOperationStatus,
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
import type { AgentRuntimeDelegate, AgentRuntimeServiceOptions, MethodArgs } from './types';
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
 * collaborators and delegates every method to a sibling module (each takes the
 * service as its first argument), so the methods stay overridable and
 * spy-able on the instance. The fields are read by those modules: internal,
 * not API.
 */
export class AgentRuntimeService {
  agentOperationModel: AgentOperationModel;
  agentFactory?: (config: GeneralAgentConfig) => Agent;
  completionLifecycle: CompletionLifecycle;
  coordinator: AgentRuntimeCoordinator;
  delegate: AgentRuntimeDelegate;
  humanIntervention: HumanInterventionHandler;
  streamManager: IStreamEventManager;
  queueService: QueueService | null;
  traceRecorder: OperationTraceRecorder;
  toolExecutionService: ToolExecutionService;
  get baseURL() {
    const baseUrl = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';

    return urlJoin(baseUrl, '/api/agent');
  }
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
  messageModel: MessageModel;
  // Lazily constructed because MessageService instantiates a FileService
  // which eagerly creates the S3 client and throws when S3 env vars are
  // missing — eager construction would break every test that builds an
  // AgentRuntimeService without mocking the file backend.
  messageServiceInstance?: MessageService;
  get messageService(): MessageService {
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
    });
    this.humanIntervention = new HumanInterventionHandler(db, this.messageModel);

    // Initialize ToolExecutionService with dependencies
    const builtinToolsExecutor = new BuiltinToolsExecutor(db, userId);

    this.toolExecutionService = new ToolExecutionService({
      builtinToolsExecutor,
      mcpService,
    });

    // Setup local execution callback for LocalQueueServiceImpl
    this.setupLocalExecutionCallback();
  }

  // ==================== Operation Interruption ====================

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
  // ==================== Delegates to the sibling modules ====================
  startStepLockHeartbeat(...args: MethodArgs<typeof startStepLockHeartbeat>) {
    return startStepLockHeartbeat(this, ...args);
  }

  isOperationInterrupted(...args: MethodArgs<typeof isOperationInterrupted>) {
    return isOperationInterrupted(this, ...args);
  }

  interruptOperation(...args: MethodArgs<typeof interruptOperation>) {
    return interruptOperation(this, ...args);
  }

  acceptsFileWorks(...args: MethodArgs<typeof acceptsFileWorks>) {
    return acceptsFileWorks(this, ...args);
  }

  acceptsMemberRuntimeEnd(...args: MethodArgs<typeof acceptsMemberRuntimeEnd>) {
    return acceptsMemberRuntimeEnd(this, ...args);
  }

  setQueuedMessages(...args: MethodArgs<typeof setQueuedMessages>) {
    return setQueuedMessages(this, ...args);
  }

  readQueuedMessagesFlag(...args: MethodArgs<typeof readQueuedMessagesFlag>) {
    return readQueuedMessagesFlag(this, ...args);
  }

  controlCompletedToolResult(...args: MethodArgs<typeof controlCompletedToolResult>) {
    return controlCompletedToolResult(this, ...args);
  }

  scheduleContinuation(...args: MethodArgs<typeof scheduleContinuation>) {
    return scheduleContinuation(this, ...args);
  }

  releaseOperationLock(...args: MethodArgs<typeof releaseOperationLock>) {
    return releaseOperationLock(this, ...args);
  }

  getOperationStatus(...args: MethodArgs<typeof getOperationStatus>) {
    return getOperationStatus(this, ...args);
  }

  startExecution(...args: MethodArgs<typeof startExecution>) {
    return startExecution(this, ...args);
  }

  loadInterventionContinuationState(...args: MethodArgs<typeof loadInterventionContinuationState>) {
    return loadInterventionContinuationState(this, ...args);
  }

  ensureInterventionContinuationStarted(
    ...args: MethodArgs<typeof ensureInterventionContinuationStarted>
  ) {
    return ensureInterventionContinuationStarted(this, ...args);
  }

  persistInterventionDispatchAck(...args: MethodArgs<typeof persistInterventionDispatchAck>) {
    return persistInterventionDispatchAck(this, ...args);
  }

  getPendingInterventions(...args: MethodArgs<typeof getPendingInterventions>) {
    return getPendingInterventions(this, ...args);
  }

  processHumanIntervention(...args: MethodArgs<typeof processHumanIntervention>) {
    return processHumanIntervention(this, ...args);
  }

  shouldReplayPendingInterventionLifecycle(
    ...args: Parameters<typeof shouldReplayPendingInterventionLifecycle>
  ) {
    return shouldReplayPendingInterventionLifecycle(...args);
  }

  recordInterventionLifecycleCompletion(
    ...args: MethodArgs<typeof recordInterventionLifecycleCompletion>
  ) {
    return recordInterventionLifecycleCompletion(this, ...args);
  }

  buildShareAbortResult(...args: MethodArgs<typeof buildShareAbortResult>) {
    return buildShareAbortResult(this, ...args);
  }

  createOperation(...args: MethodArgs<typeof createOperation>) {
    return createOperation(this, ...args);
  }

  queryUiMessages(...args: MethodArgs<typeof queryUiMessages>) {
    return queryUiMessages(this, ...args);
  }

  usesGatewayMessagePatch(...args: Parameters<typeof usesGatewayMessagePatch>) {
    return usesGatewayMessagePatch(...args);
  }

  queryMessagesFromDB(...args: MethodArgs<typeof queryMessagesFromDB>) {
    return queryMessagesFromDB(this, ...args);
  }

  refreshMessagesFromDB(...args: MethodArgs<typeof refreshMessagesFromDB>) {
    return refreshMessagesFromDB(this, ...args);
  }

  resolveLastAssistantMessageFromDB(...args: MethodArgs<typeof resolveLastAssistantMessageFromDB>) {
    return resolveLastAssistantMessageFromDB(this, ...args);
  }

  resolveLastAssistantContentFromThread(
    ...args: MethodArgs<typeof resolveLastAssistantContentFromThread>
  ) {
    return resolveLastAssistantContentFromThread(this, ...args);
  }

  queryStepEntryMessages(...args: MethodArgs<typeof queryStepEntryMessages>) {
    return queryStepEntryMessages(this, ...args);
  }

  resolveAsyncToolResumeParentMessageId(
    ...args: Parameters<typeof resolveAsyncToolResumeParentMessageId>
  ) {
    return resolveAsyncToolResumeParentMessageId(...args);
  }

  executeStep(...args: MethodArgs<typeof executeStep>) {
    return executeStep(this, ...args);
  }

  tryResumeParentFromAsyncTool(...args: MethodArgs<typeof tryResumeParentFromAsyncTool>) {
    return tryResumeParentFromAsyncTool(this, ...args);
  }

  maybeScheduleAsyncToolVerify(...args: MethodArgs<typeof maybeScheduleAsyncToolVerify>) {
    return maybeScheduleAsyncToolVerify(this, ...args);
  }

  allPendingToolsFulfilled(...args: MethodArgs<typeof allPendingToolsFulfilled>) {
    return allPendingToolsFulfilled(this, ...args);
  }

  resolveAsyncToolOnComplete(...args: MethodArgs<typeof resolveAsyncToolOnComplete>) {
    return resolveAsyncToolOnComplete(this, ...args);
  }

  parkForClientLlm(...args: MethodArgs<typeof parkForClientLlm>) {
    return parkForClientLlm(this, ...args);
  }

  resumeFromClientLlmWait(...args: MethodArgs<typeof resumeFromClientLlmWait>) {
    return resumeFromClientLlmWait(this, ...args);
  }

  restoreClientLlmWait(...args: MethodArgs<typeof restoreClientLlmWait>) {
    return restoreClientLlmWait(this, ...args);
  }

  revertClientWaitResumeWithRetry(...args: MethodArgs<typeof revertClientWaitResumeWithRetry>) {
    return revertClientWaitResumeWithRetry(this, ...args);
  }

  listClientLlmWaits(...args: MethodArgs<typeof listClientLlmWaits>) {
    return listClientLlmWaits(this, ...args);
  }

  expireClientLlmWait(...args: MethodArgs<typeof expireClientLlmWait>) {
    return expireClientLlmWait(this, ...args);
  }

  endExpiredClientLlmWait(...args: MethodArgs<typeof endExpiredClientLlmWait>) {
    return endExpiredClientLlmWait(this, ...args);
  }

  updateAssistantRowWithRetry(...args: MethodArgs<typeof updateAssistantRowWithRetry>) {
    return updateAssistantRowWithRetry(this, ...args);
  }

  finishClientLlmWaitExpiry(...args: MethodArgs<typeof finishClientLlmWaitExpiry>) {
    return finishClientLlmWaitExpiry(this, ...args);
  }

  publishSubAgentProgress(...args: MethodArgs<typeof publishSubAgentProgress>) {
    return publishSubAgentProgress(this, ...args);
  }

  completeSubAgentBridge(...args: MethodArgs<typeof completeSubAgentBridge>) {
    return completeSubAgentBridge(this, ...args);
  }

  isCallSubAgentToolMessage(...args: MethodArgs<typeof isCallSubAgentToolMessage>) {
    return isCallSubAgentToolMessage(this, ...args);
  }

  loadGroupMemberBridge(...args: MethodArgs<typeof loadGroupMemberBridge>) {
    return loadGroupMemberBridge(this, ...args);
  }

  countFulfilledMemberAnchors(...args: MethodArgs<typeof countFulfilledMemberAnchors>) {
    return countFulfilledMemberAnchors(this, ...args);
  }

  completeGroupActionMember(...args: MethodArgs<typeof completeGroupActionMember>) {
    return completeGroupActionMember(this, ...args);
  }

  completeGroupMemberBarrier(...args: MethodArgs<typeof completeGroupMemberBarrier>) {
    return completeGroupMemberBarrier(this, ...args);
  }

  scheduleGroupMemberTimeout(...args: MethodArgs<typeof scheduleGroupMemberTimeout>) {
    return scheduleGroupMemberTimeout(this, ...args);
  }

  handleGroupMemberTimeout(...args: MethodArgs<typeof handleGroupMemberTimeout>) {
    return handleGroupMemberTimeout(this, ...args);
  }

  setupLocalExecutionCallback(...args: MethodArgs<typeof setupLocalExecutionCallback>) {
    return setupLocalExecutionCallback(this, ...args);
  }

  resolveLlmExecutor(...args: MethodArgs<typeof resolveLlmExecutor>) {
    return resolveLlmExecutor(this, ...args);
  }

  getLlmExecutor(...args: MethodArgs<typeof getLlmExecutor>) {
    return getLlmExecutor(this, ...args);
  }

  createAgentRuntime(...args: MethodArgs<typeof createAgentRuntime>) {
    return createAgentRuntime(this, ...args);
  }

  computeDeviceContext(...args: MethodArgs<typeof computeDeviceContext>) {
    return computeDeviceContext(this, ...args);
  }

  shouldContinueExecution(...args: Parameters<typeof shouldContinueExecution>) {
    return shouldContinueExecution(...args);
  }

  calculateStepDelay(...args: Parameters<typeof calculateStepDelay>) {
    return calculateStepDelay(...args);
  }

  calculatePriority(...args: Parameters<typeof calculatePriority>) {
    return calculatePriority(...args);
  }

  determineCompletionReason(...args: Parameters<typeof determineCompletionReason>) {
    return determineCompletionReason(...args);
  }

  executeSync(...args: MethodArgs<typeof executeSync>) {
    return executeSync(this, ...args);
  }
}
