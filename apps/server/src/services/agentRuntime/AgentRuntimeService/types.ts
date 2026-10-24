import type { Agent, AgentState, GeneralAgentConfig } from '@lobechat/agent-runtime';
import type { ISnapshotStore } from '@lobechat/agent-tracing';
import {
  type ExecSubAgentParams,
  type ExecSubAgentResult,
  type ExecVirtualSubAgentParams,
} from '@lobechat/types';

import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';
import type {
  AgentRuntimeCoordinator,
  AgentRuntimeCoordinatorOptions,
} from '@/server/modules/AgentRuntime';
import type { IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import type { MessageService } from '@/server/services/message';
import type { QueueService } from '@/server/services/queue';
import type { SteerQueueScope } from '@/server/services/redis/steerQueue';
import type { ToolExecutionService } from '@/server/services/toolExecution';

import type { CompletionLifecycle } from '../CompletionLifecycle';
import type { HumanInterventionHandler } from '../HumanInterventionHandler';
import type { OperationTraceRecorder } from '../OperationTraceRecorder';
import { type ExecGroupMemberParams, type ExecGroupMemberResult } from '../types';
import type {
  allPendingToolsFulfilled,
  maybeScheduleAsyncToolVerify,
  resolveAsyncToolOnComplete,
  tryResumeParentFromAsyncTool,
} from './asyncTool';
import type {
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
import type { createOperation } from './createOperation';
import type { DeferredInitRunner } from './executeStep/deferredInit';
import type { executeStep } from './executeStep/index';
import type { executeSync } from './executeSync';
import type {
  completeGroupActionMember,
  completeGroupMemberBarrier,
  countFulfilledMemberAnchors,
  handleGroupMemberTimeout,
  loadGroupMemberBridge,
  scheduleGroupMemberTimeout,
} from './groupMember';
import type {
  ensureInterventionContinuationStarted,
  getPendingInterventions,
  loadInterventionContinuationState,
  persistInterventionDispatchAck,
  processHumanIntervention,
  recordInterventionLifecycleCompletion,
  shouldReplayPendingInterventionLifecycle,
} from './intervention';
import type {
  queryMessagesFromDB,
  queryStepEntryMessages,
  queryUiMessages,
  refreshMessagesFromDB,
  resolveAsyncToolResumeParentMessageId,
  resolveLastAssistantContentFromThread,
  resolveLastAssistantMessageFromDB,
  usesGatewayMessagePatch,
} from './messages';
import type {
  acceptsFileWorks,
  acceptsMemberRuntimeEnd,
  controlCompletedToolResult,
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
import type {
  computeDeviceContext,
  createAgentRuntime,
  getLlmExecutor,
  resolveLlmExecutor,
  setupLocalExecutionCallback,
} from './runtimeFactory';
import type { buildShareAbortResult } from './shareRunGate';
import type {
  calculatePriority,
  calculateStepDelay,
  determineCompletionReason,
  shouldContinueExecution,
} from './stepPolicy';
import type {
  completeSubAgentBridge,
  isCallSubAgentToolMessage,
  publishSubAgentProgress,
} from './subAgentBridge';

export interface InterventionLifecycleCheckpoint {
  state: 'completed' | 'pending';
  stepIndex: number;
}

/**
 * Operations the runtime delegates UP to its owning layer (AiAgentService).
 *
 * The dependency arrow is one-way: AiAgentService → AgentRuntimeService. The
 * runtime is the low-level step executor — it cannot resolve agent configs,
 * build tool engines, manage threads, or run the full `execAgent` pipeline;
 * those live in the layer above it. Yet some tools (e.g. `lobe-agent.callSubAgent`)
 * need exactly such a high-level action *mid-step*. Rather than import
 * AiAgentService (which would be a circular dependency), the runtime delegates
 * these operations back to its owner through callbacks injected here.
 *
 * Convention: every future "the runtime, mid-execution, must trigger a
 * higher-layer pipeline" capability belongs on this delegate — not as a loose
 * top-level option. One named home for the whole upward-call surface.
 */
export interface AgentRuntimeDelegate {
  /**
   * Hand the topic's finished background sub-agent results to their parent
   * agent as a new turn, unless a run of that topic is still going (its own
   * completion delivers them then). Called when a background sub-agent finishes
   * and when a topic run settles. Never throws.
   */
  deliverBackgroundSubAgentResults?: (params: {
    /** The run that is settling right now, which no longer counts as busy. */
    settledOperationId?: string;
    topicId: string;
  }) => Promise<void>;
  /**
   * Fork a group member ("call agent member") under a `lobe-group-management`
   * tool call. Handles both in-group (non-isolated, shared group session) and
   * isolated members, installing the group-action member completion bridge that
   * enforces the K=N member barrier before resuming/finishing the supervisor.
   */
  execGroupMember?: (params: ExecGroupMemberParams) => Promise<ExecGroupMemberResult>;
  /**
   * Run a legacy agent invocation through the full high-level pipeline
   * (AiAgentService.execSubAgent → execAgent: agent-config resolution, tool
   * engine, context engineering, createOperation).
   */
  execSubAgent?: (params: ExecSubAgentParams) => Promise<ExecSubAgentResult>;
  /**
   * Fork a `lobe-agent.callSubAgent` virtual child run. The child is marked as a
   * sub-agent and owns the completion bridge that backfills the parent tool
   * placeholder before resuming the parked parent operation.
   */
  execVirtualSubAgent?: (params: ExecVirtualSubAgentParams) => Promise<ExecSubAgentResult>;
  /**
   * The run reached a decision point right before its next LLM call: take the
   * follow-ups the user queued behind it into the run as a steer user message
   * (merged, access re-checked, persisted where a composer send would anchor
   * it). Follow-ups that cannot join a running turn (attachments, a different
   * agent, tool / skill selections) stay queued for the hand-back. Resolves to
   * `undefined` when nothing was taken in.
   */
  injectQueuedFollowUp?: (params: {
    operationId: string;
    scope: SteerQueueScope;
    state: AgentState;
  }) => Promise<{ messageId: string } | undefined>;
  /** Run the init an operation was created without (see `DeferredInitRunner`). */
  runDeferredInit?: DeferredInitRunner;
  /**
   * A top-level run just finished: start the follow-ups the user queued behind
   * it as the next turn (the composer pipeline, with `steer`). Resolves to
   * `undefined` when nothing was queued or the start failed — the follow-ups
   * then stay queued; it never throws into the finishing step.
   */
  startQueuedFollowUp?: (params: {
    operationId: string;
    scope: SteerQueueScope;
  }) => Promise<{ operationId: string } | undefined>;
  /**
   * Re-check that an Agent Share visitor run is STILL authorized to continue,
   * called on EVERY step. Without it, a revocation that lands mid-run (link →
   * private, share disabled, agent deleted) would only stop NEW requests: the
   * already-created operation keeps its tool snapshot and gateway channel and
   * keeps running under the CREATOR's credentials and budget, unstoppable by
   * the visitor (whose Stop button re-resolves the now-private share and gets
   * `FORBIDDEN`). Re-checking at every step boundary means a revocation always
   * takes effect within one step, with no durable interrupt-retry machinery.
   *
   * Implemented by AiAgentService via `AgentShareModel.isRunStillAuthorized`.
   * Returns `false` (not a throw) for an ordinary "no longer authorized"
   * outcome; the caller treats a THROWN error the same as `false` — fail
   * closed, never fail open.
   */
  verifyShareRunStillAuthorized?: (params: {
    agentId: string;
    shareId: string;
  }) => Promise<boolean>;
}

export interface AgentRuntimeServiceOptions {
  /**
   * Custom agent factory. When provided, this function is called instead of
   * the default `new GeneralChatAgent(config)` to create the Agent instance.
   * This allows injecting alternative Agent implementations (e.g. GraphAgent)
   * without the service needing to know about them.
   */
  agentFactory?: (config: GeneralAgentConfig) => Agent;
  /**
   * Coordinator configuration options
   * Allows injection of custom stateManager and streamEventManager
   */
  coordinatorOptions?: AgentRuntimeCoordinatorOptions;
  /**
   * Operations the runtime delegates up to its owning layer. See
   * {@link AgentRuntimeDelegate}. Injected by AiAgentService so the runtime can
   * trigger high-level pipelines (e.g. sub-agent forking) mid-step without a
   * circular import.
   */
  delegate?: AgentRuntimeDelegate;
  /**
   * Opt IN to agent-share visitor rows for the models this service owns.
   * Reserved for share-runtime entry points that drive a visitor turn under
   * the CREATOR's `userId`. Defaults to false. See
   * {@link import('@/database/models/message').MessageModelOptions}.
   */
  includeShareVisitor?: boolean;
  /**
   * Custom QueueService
   * Set to null to disable queue scheduling (for synchronous execution tests)
   */
  queueService?: QueueService | null;
  /**
   * Optional snapshot store for persisting agent execution traces.
   * When provided, execution snapshots are recorded on every step and finalized on completion.
   * In dev mode without this option, falls back to FileSnapshotStore automatically.
   */
  snapshotStore?: ISnapshotStore;
  /**
   * Custom StreamEventManager
   * Defaults to Redis-based StreamEventManager
   * Can pass InMemoryStreamEventManager in test environments
   */
  streamEventManager?: IStreamEventManager;
  /**
   * Workspace id for scoping all DB reads/writes (messages, agent_operations).
   * Falls back to user-personal scope when omitted.
   */
  workspaceId?: string;
}

/**
 * Agent Runtime Service
 * Encapsulates Agent execution logic and provides a unified service interface
 *
 * Supports dependency injection for testing with in-memory implementations:
 * ```ts
 * // Production environment (uses Redis by default)
 * const service = new AgentRuntimeService(db, userId);
 *
 * // Test environment
 * const service = new AgentRuntimeService(db, userId, {
 *   streamEventManager: new InMemoryStreamEventManager(),
 *   queueService: null, // Disable queue, use executeSync
 * });
 * ```
 */

/** A sibling-module function's arguments after the service it runs against. */
export type MethodArgs<F> = F extends (svc: any, ...args: infer A) => any ? A : never;

/** A sibling-module function bound to the service it runs against. */
type Bound<F> = F extends (svc: any, ...args: infer A) => infer R ? (...args: A) => R : never;

/**
 * What the sibling modules read off the service: its collaborators and the
 * methods they call back into. The service hands each module this view (each
 * module picks the members it uses), so the members stay private on the class.
 */
export interface AgentRuntimeServiceContext {
  acceptsFileWorks: Bound<typeof acceptsFileWorks>;
  acceptsMemberRuntimeEnd: Bound<typeof acceptsMemberRuntimeEnd>;
  readonly agentFactory: ((config: GeneralAgentConfig) => Agent) | undefined;
  readonly agentOperationModel: AgentOperationModel;
  allPendingToolsFulfilled: Bound<typeof allPendingToolsFulfilled>;
  readonly baseURL: string;
  buildShareAbortResult: Bound<typeof buildShareAbortResult>;
  calculatePriority: typeof calculatePriority;
  calculateStepDelay: typeof calculateStepDelay;
  completeGroupActionMember: Bound<typeof completeGroupActionMember>;
  completeGroupMemberBarrier: Bound<typeof completeGroupMemberBarrier>;
  completeSubAgentBridge: Bound<typeof completeSubAgentBridge>;
  readonly completionLifecycle: CompletionLifecycle;
  computeDeviceContext: Bound<typeof computeDeviceContext>;
  controlCompletedToolResult: Bound<typeof controlCompletedToolResult>;
  readonly coordinator: AgentRuntimeCoordinator;
  countFulfilledMemberAnchors: Bound<typeof countFulfilledMemberAnchors>;
  createAgentRuntime: Bound<typeof createAgentRuntime>;
  createOperation: Bound<typeof createOperation>;
  readonly delegate: AgentRuntimeDelegate;
  determineCompletionReason: typeof determineCompletionReason;
  endExpiredClientLlmWait: Bound<typeof endExpiredClientLlmWait>;
  ensureInterventionContinuationStarted: Bound<typeof ensureInterventionContinuationStarted>;
  executeStep: Bound<typeof executeStep>;
  executeSync: Bound<typeof executeSync>;
  expireClientLlmWait: Bound<typeof expireClientLlmWait>;
  finishClientLlmWaitExpiry: Bound<typeof finishClientLlmWaitExpiry>;
  getLlmExecutor: Bound<typeof getLlmExecutor>;
  getOperationStatus: Bound<typeof getOperationStatus>;
  getPendingInterventions: Bound<typeof getPendingInterventions>;
  handleGroupMemberTimeout: Bound<typeof handleGroupMemberTimeout>;
  readonly humanIntervention: HumanInterventionHandler;
  injectQueuedFollowUp: Bound<typeof injectQueuedFollowUp>;
  interruptOperation: Bound<typeof interruptOperation>;
  isCallSubAgentToolMessage: Bound<typeof isCallSubAgentToolMessage>;
  isOperationInterrupted: Bound<typeof isOperationInterrupted>;
  listClientLlmWaits: Bound<typeof listClientLlmWaits>;
  loadGroupMemberBridge: Bound<typeof loadGroupMemberBridge>;
  loadInterventionContinuationState: Bound<typeof loadInterventionContinuationState>;
  maybeScheduleAsyncToolVerify: Bound<typeof maybeScheduleAsyncToolVerify>;
  readonly messageModel: MessageModel;
  readonly messageService: MessageService;
  parkForClientLlm: Bound<typeof parkForClientLlm>;
  persistInterventionDispatchAck: Bound<typeof persistInterventionDispatchAck>;
  processHumanIntervention: Bound<typeof processHumanIntervention>;
  publishSubAgentProgress: Bound<typeof publishSubAgentProgress>;
  queryMessagesFromDB: Bound<typeof queryMessagesFromDB>;
  queryStepEntryMessages: Bound<typeof queryStepEntryMessages>;
  queryUiMessages: Bound<typeof queryUiMessages>;
  readonly queueService: QueueService | null;
  readQueuedMessagesFlag: Bound<typeof readQueuedMessagesFlag>;
  recordInterventionLifecycleCompletion: Bound<typeof recordInterventionLifecycleCompletion>;
  refreshMessagesFromDB: Bound<typeof refreshMessagesFromDB>;
  releaseOperationLock: Bound<typeof releaseOperationLock>;
  resolveAsyncToolOnComplete: Bound<typeof resolveAsyncToolOnComplete>;
  resolveAsyncToolResumeParentMessageId: typeof resolveAsyncToolResumeParentMessageId;
  resolveLastAssistantContentFromThread: Bound<typeof resolveLastAssistantContentFromThread>;
  resolveLastAssistantMessageFromDB: Bound<typeof resolveLastAssistantMessageFromDB>;
  resolveLlmExecutor: Bound<typeof resolveLlmExecutor>;
  restoreClientLlmWait: Bound<typeof restoreClientLlmWait>;
  resumeFromClientLlmWait: Bound<typeof resumeFromClientLlmWait>;
  revertClientWaitResumeWithRetry: Bound<typeof revertClientWaitResumeWithRetry>;
  scheduleContinuation: Bound<typeof scheduleContinuation>;
  scheduleGroupMemberTimeout: Bound<typeof scheduleGroupMemberTimeout>;
  readonly serverDB: LobeChatDatabase;
  setQueuedMessages: Bound<typeof setQueuedMessages>;
  setupLocalExecutionCallback: Bound<typeof setupLocalExecutionCallback>;
  shouldContinueExecution: typeof shouldContinueExecution;
  shouldReplayPendingInterventionLifecycle: typeof shouldReplayPendingInterventionLifecycle;
  startExecution: Bound<typeof startExecution>;
  startStepLockHeartbeat: Bound<typeof startStepLockHeartbeat>;
  readonly streamManager: IStreamEventManager;
  readonly toolExecutionService: ToolExecutionService;
  readonly traceRecorder: OperationTraceRecorder;
  tryResumeParentFromAsyncTool: Bound<typeof tryResumeParentFromAsyncTool>;
  updateAssistantRowWithRetry: Bound<typeof updateAssistantRowWithRetry>;
  readonly userId: string;
  usesGatewayMessagePatch: typeof usesGatewayMessagePatch;
  readonly workspaceId: string | undefined;
}
