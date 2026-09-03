import { randomUUID } from 'node:crypto';

import type {
  Agent,
  AgentRuntimeContext,
  AgentState,
  GeneralAgentConfig,
  ToolCallHookEvent,
  ToolForwardingRequest,
  ToolRunResult,
} from '@lobechat/agent-runtime';
import {
  AgentRuntime,
  extractActivatedToolIdsFromMessages,
  findInMessages,
  GeneralChatAgent,
  isParkedStatus,
} from '@lobechat/agent-runtime';
import type { ISnapshotStore } from '@lobechat/agent-tracing';
import { dynamicInterventionAudits } from '@lobechat/builtin-tools/dynamicInterventionAudits';
import { parse } from '@lobechat/conversation-flow';
import { getModelPropertyWithFallback } from '@lobechat/model-runtime';
import {
  context as otelContext,
  SpanStatusCode,
  trace as otelTrace,
} from '@lobechat/observability-otel/api';
import {
  asyncToolResumeCounter,
  buildInvokeAgentAttributes,
  buildInvokeAgentResultAttributes,
  invokeAgentSpanName,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import {
  type ChatToolPayload,
  type EvalToolForwardingConfig,
  type ExecSubAgentParams,
  type ExecSubAgentResult,
  type ExecVirtualSubAgentParams,
  type UIChatMessage,
} from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';
import urlJoin from 'url-join';

import {
  deriveAgentInterventionQueueDeduplicationId,
  matchesAgentInterventionContinuationProvenance,
} from '@/business/server/agent-run/agentInterventionIdentity';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { type AgentRuntimeCoordinatorOptions } from '@/server/modules/AgentRuntime';
import { AgentRuntimeCoordinator, createStreamEventManager } from '@/server/modules/AgentRuntime';
import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';
import { hasNonPersistedMessage } from '@/server/modules/AgentRuntime/messagePersistence';
import {
  createRuntimeExecutors,
  type RuntimeExecutorContext,
} from '@/server/modules/AgentRuntime/RuntimeExecutors';
import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { toAgentSignalTraceEvents } from '@/server/services/agentSignal/observability/traceEvents';
import { FileService } from '@/server/services/file';
import { mcpService } from '@/server/services/mcp';
import { MessageService } from '@/server/services/message';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';
import { ToolExecutionService } from '@/server/services/toolExecution';
import { BuiltinToolsExecutor } from '@/server/services/toolExecution/builtin';
import { stateHasEntityFileEdits } from '@/server/services/workRegistration';

import { isAbortError, throwIfAborted } from './abort';
import {
  CompletionLifecycle,
  CriticalAgentInterventionPersistenceError,
  extractTextFromMessage,
  findLastAssistantMessage,
  isAgentShareRun,
  isSuccessLikeCompletionReason,
  normalizeCompletionMessages,
} from './CompletionLifecycle';
import { logToolCallPc } from './formalObservation';
import { type AgentHook, hookDispatcher } from './hooks';
import { HumanInterventionHandler } from './HumanInterventionHandler';
import { OperationTraceRecorder } from './OperationTraceRecorder';
import { createDefaultSnapshotStore } from './snapshotStore';
import { buildStepPresentation, formatTokenCount } from './stepPresentation';
import {
  type AgentExecutionParams,
  type AgentExecutionResult,
  type ExecGroupMemberParams,
  type ExecGroupMemberResult,
  type GroupActionMemberBridgeParams,
  type GroupActionOnComplete,
  type GroupMemberTimeoutParams,
  type OperationCreationParams,
  type OperationCreationResult,
  type OperationStatusResult,
  type PendingInterventionsResult,
  type StartExecutionParams,
  type StartExecutionResult,
  type StepCompletionReason,
  type SubAgentBridgeParams,
} from './types';

if (process.env.VERCEL) {
  // Route debug output to stdout (`console.info`) instead of stderr, which
  // Vercel would otherwise surface as error-level logs.
  debug.log = console.info.bind(console);
}

const log = debug('lobe-server:agent-runtime-service');

/**
 * Base delay before the first `verifyAsyncToolBarrier` re-check fires after a
 * sub-agent completion found the parent not yet resumable. Long enough for
 * the parent's parking step to finish persisting, short enough that a lost
 * resume is recovered promptly. Subsequent attempts back off exponentially —
 * see {@link asyncToolVerifyDelayMs}.
 */
const ASYNC_TOOL_VERIFY_DELAY_MS = 15_000;

/**
 * Maximum number of bounded watchdog re-checks armed per parked parent. The
 * watchdog re-arms after each unsatisfied check (instead of the old single
 * shot) so a transient miss — a read-replica lag, a sibling dying between
 * backfill and resume — is retried rather than leaving the parent stuck in
 * `waiting_for_async_tool` forever. With exponential backoff from a 15s base,
 * 5 attempts span ~15s → ~7.75min total before giving up. For details see: async sub-agent suspend/resume stability hardening — bounded watchdog retry with exponential backoff instead of single-shot verification.
 */
const ASYNC_TOOL_VERIFY_MAX_ATTEMPTS = 5;

/** Hard ceiling on a single backoff delay so late attempts don't overshoot. */
const ASYNC_TOOL_VERIFY_MAX_DELAY_MS = 240_000;

const STEP_LOCK_TTL_SECONDS = 120;
/**
 * How often a live step re-reads its own operation state to notice an
 * interrupt. Interrupts are persisted by a different invocation, so this poll
 * is the only way a running tool learns it should stop.
 */
const STEP_ABORT_POLL_INTERVAL_MS = 2_000;
/** Cap on the exponential backoff multiplier after consecutive poll failures. */
const STEP_ABORT_POLL_MAX_BACKOFF = 8;
const STEP_LOCK_HEARTBEAT_MS = 30_000;
const DURABLE_LEASE_HEARTBEAT_EVERY_TICKS = 3;
const EVAL_TOOL_FORWARDING_HOOK_ID = 'eval-tool-forwarding';
const INTERVENTION_LIFECYCLE_CHECKPOINT_KEY = '_agentInterventionLifecycle';

interface InterventionLifecycleCheckpoint {
  state: 'completed' | 'pending';
  stepIndex: number;
}

const toToolForwardingFailure = (error?: unknown): ToolRunResult => ({
  content: error === undefined ? 'Tool forwarding failed' : String(error),
  error,
  success: false,
});

export const createEvalToolForwardingHook = (
  toolForwarding: EvalToolForwardingConfig,
  caseId?: string,
): AgentHook => ({
  handler: async (event) => {
    const { apiName, args, callIndex, identifier, mock, operationId, stepIndex } =
      event as unknown as ToolCallHookEvent;
    const target = toolForwarding[identifier];
    if (!target) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), target.timeoutMs ?? 15_000);

    try {
      const payload: ToolForwardingRequest = {
        data: { apiName, args, identifier },
        metadata: { ...(caseId && { caseId }), callIndex, operationId, stepIndex },
        type: 'toolCall',
      };
      const response = await ssrfSafeFetch(target.endpoint, {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
      if (!response.ok) throw `Tool forwarding server responded with HTTP ${response.status}`;

      const body: unknown = await response.json();
      if (!isRecord(body)) throw new Error('Invalid tool forwarding response');

      if (body.success === true) {
        const result = body.data;
        if (
          isRecord(result) &&
          typeof result.content === 'string' &&
          typeof result.success === 'boolean'
        ) {
          mock({ ...result, content: result.content, success: result.success });
        } else {
          mock({ content: 'No tool result', success: true });
        }
      } else {
        mock(toToolForwardingFailure(body.error));
      }
    } catch (error) {
      mock(toToolForwardingFailure(error));
    } finally {
      clearTimeout(timeout);
    }
  },
  id: EVAL_TOOL_FORWARDING_HOOK_ID,
  type: 'beforeToolCall',
});

/**
 * How many times a delivery that lost the operation lock re-queues itself
 * before giving up and falling back to a retryable response.
 */
const STEP_LOCK_RETRY_MAX_ATTEMPTS = 12;
/** Base delay for the first lock-conflict re-delivery. */
const STEP_LOCK_RETRY_BASE_DELAY_MS = 15_000;
/**
 * Ceiling on a single lock-conflict backoff. Together with the base delay,
 * {@link STEP_LOCK_RETRY_MAX_ATTEMPTS} attempts span ~20 minutes — comfortably
 * longer than the platform's hard step ceiling, so a step that legitimately
 * holds the lock for minutes no longer strands the delivery waiting behind it.
 */
const STEP_LOCK_RETRY_MAX_DELAY_MS = 120_000;

/**
 * Exponential backoff for the Nth (1-based) lock-conflict re-delivery:
 * 15s, 30s, 60s, 120s, then capped at {@link STEP_LOCK_RETRY_MAX_DELAY_MS}.
 */
const stepLockRetryDelayMs = (attempt: number): number =>
  Math.min(
    STEP_LOCK_RETRY_BASE_DELAY_MS * 2 ** (Math.max(1, attempt) - 1),
    STEP_LOCK_RETRY_MAX_DELAY_MS,
  );

/**
 * Exponential backoff delay for the Nth (1-based) watchdog re-check:
 * 15s, 30s, 60s, 120s, 240s, capped at {@link ASYNC_TOOL_VERIFY_MAX_DELAY_MS}.
 */
const asyncToolVerifyDelayMs = (attempt: number): number =>
  Math.min(
    ASYNC_TOOL_VERIFY_DELAY_MS * 2 ** (Math.max(1, attempt) - 1),
    ASYNC_TOOL_VERIFY_MAX_DELAY_MS,
  );

const createStepLockOwner = (operationId: string, stepIndex: number): string =>
  `${operationId}:${stepIndex}:${process.pid}:${Date.now()}:${randomUUID()}`;

/**
 * Format error for storage in message pluginError metadata.
 * Handles Error objects which don't serialize properly with JSON.stringify.
 */
const formatErrorForMetadata = (error: unknown): Record<string, any> | undefined => {
  if (!error) return undefined;
  if (error instanceof Error) return { message: error.message, name: error.name };
  if (typeof error === 'object' && 'message' in error) return error as Record<string, any>;
  return { message: String(error) };
};

/**
 * Extract a short, human-readable reason string from a failed operation's
 * `state.error`, for inlining into the tool-result `content` a parent agent
 * sees. Without this the supervising agent only gets the opaque generic note
 * ("Sub-agent did not complete (error).") and cannot tell *why* a `callAgent`
 * dispatch failed — so it can't retry, switch target, or report the cause; it
 * silently falls back to answering itself (issue #16257). The full structured
 * error still rides on `pluginError`; this is just the readable summary.
 */
const formatSubAgentErrorReason = (error: unknown): string | undefined => {
  const message = formatErrorForMetadata(error)?.message;
  if (typeof message !== 'string') return undefined;
  const trimmed = message.trim();
  if (!trimmed) return undefined;
  // Keep the tool result compact — a runaway provider error body would otherwise
  // bloat the parent's LLM context.
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
};

const toAgentSignalSnapshotEvents = (
  emission: Awaited<ReturnType<typeof emitAgentSignalSourceEvent>> | undefined,
) => {
  if (!emission || emission.deduped) return [];

  return toAgentSignalTraceEvents({
    actions: emission.orchestration.actions,
    results: emission.orchestration.results,
    signals: emission.orchestration.emittedSignals,
    source: emission.source,
  });
};

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
export class AgentRuntimeService {
  private agentOperationModel: AgentOperationModel;
  private agentFactory?: (config: GeneralAgentConfig) => Agent;
  private completionLifecycle: CompletionLifecycle;
  private coordinator: AgentRuntimeCoordinator;
  private delegate: AgentRuntimeDelegate;
  private humanIntervention: HumanInterventionHandler;
  private streamManager: IStreamEventManager;
  private queueService: QueueService | null;
  private traceRecorder: OperationTraceRecorder;
  private toolExecutionService: ToolExecutionService;
  private get baseURL() {
    const baseUrl = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';

    return urlJoin(baseUrl, '/api/agent');
  }
  private serverDB: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;
  private messageModel: MessageModel;
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
    // Use factory function to auto-select Redis or InMemory implementation
    this.streamManager =
      options?.streamEventManager ??
      options?.coordinatorOptions?.streamEventManager ??
      createStreamEventManager();
    this.coordinator = new AgentRuntimeCoordinator({
      ...options?.coordinatorOptions,
      streamEventManager: this.streamManager,
      // Provide the canonical UIChatMessage[] for terminal-state events so
      // the client can use the pushed payload directly instead of refetching
      // from DB. Falls back gracefully when topicId isn't set.
      uiMessagesResolver: (state) => this.queryUiMessages(state),
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

  private startStepLockHeartbeat(
    operationId: string,
    stepIndex: number,
    ownerId: string,
  ): () => void {
    let heartbeatTick = 0;
    const timer = setInterval(() => {
      heartbeatTick += 1;
      const refreshDurableLease = heartbeatTick % DURABLE_LEASE_HEARTBEAT_EVERY_TICKS === 0;

      Promise.all([
        this.coordinator.refreshStepLock(operationId, stepIndex, STEP_LOCK_TTL_SECONDS, ownerId),
        refreshDurableLease
          ? this.agentOperationModel.touchRunning(operationId)
          : Promise.resolve(true),
      ])
        .then(([refreshed, leaseRefreshed]) => {
          if (!refreshed) {
            log(
              '[%s][%d] Step lock heartbeat did not refresh; ownership may have changed',
              operationId,
              stepIndex,
            );
          }
          if (!leaseRefreshed) {
            log(
              '[%s][%d] Durable operation lease was lost; terminal persistence will be rejected',
              operationId,
              stepIndex,
            );
          }
        })
        .catch((error) => {
          log('[%s][%d] Step lock heartbeat failed: %O', operationId, stepIndex, error);
        });
    }, STEP_LOCK_HEARTBEAT_MS);

    const timerWithUnref = timer as { unref?: () => void };
    timerWithUnref.unref?.();

    return () => clearInterval(timer);
  }

  /**
   * Setup execution callback for LocalQueueServiceImpl
   * This breaks the circular dependency by using callback injection
   */
  private setupLocalExecutionCallback(): void {
    if (!this.queueService) return;

    const impl = this.queueService.getImpl();
    if (impl instanceof LocalQueueServiceImpl) {
      log('Setting up local execution callback');
      impl.setExecutionCallback(async (operationId, stepIndex, context, payload) => {
        // Mirror the QStash path where payload fields (approvedToolCall,
        // toolMessageId, resumeAsyncTool, …) ride the request body into
        // executeStep. Without this spread, local/in-memory resumes silently
        // lose their intervention/resume signal.
        await this.executeStep({ context, operationId, stepIndex, ...payload });
      });
    }
  }

  // ==================== Operation Interruption ====================

  /**
   * Interrupt a running agent operation by setting its state to 'interrupted'.
   * The agent will stop at the next step boundary (cannot abort an in-flight LLM call).
   * Works with both Redis and InMemory state managers via the coordinator abstraction.
   *
   * @returns true if the operation was interrupted, false if already in a terminal state or not found
   */
  async interruptOperation(operationId: string): Promise<boolean> {
    const state = await this.coordinator.loadAgentState(operationId);
    if (!state) return false;

    if (state.status === 'done' || state.status === 'error' || state.status === 'interrupted') {
      return false;
    }

    await this.coordinator.saveAgentState(operationId, {
      ...state,
      lastModified: new Date().toISOString(),
      status: 'interrupted',
    });

    log('[%s] Operation interrupted', operationId);
    return true;
  }

  /** Load the authoritative runtime state for a deterministic intervention continuation. */
  async loadInterventionContinuationState(operationId: string): Promise<AgentState | null> {
    return this.coordinator.loadAgentState(operationId);
  }

  /**
   * Re-enqueue a continuation whose durable state was written but whose first
   * queue delivery may have been lost with the resolving HTTP process. The
   * operation id and step index are stable, so the ordinary distributed step
   * lock de-duplicates concurrent/repeated schedules.
   */
  async ensureInterventionContinuationStarted(
    operationId: string,
  ): Promise<'already_started' | 'missing' | 'scheduled'> {
    const state = await this.coordinator.loadAgentState(operationId);
    if (!state) return 'missing';

    const provenance = state.metadata?.agentInterventionContinuation as
      | {
          resolutionRequestId?: unknown;
          sourceOperationId?: unknown;
          sourceToolMessageIds?: unknown;
        }
      | undefined;
    const preparation = state.metadata?.agentInterventionPreparation as
      | {
          deduplicationId?: unknown;
          resolutionRequestId?: unknown;
          state?: unknown;
          stepIndex?: unknown;
        }
      | undefined;
    if (
      typeof provenance?.resolutionRequestId !== 'string' ||
      typeof provenance.sourceOperationId !== 'string' ||
      !Array.isArray(provenance.sourceToolMessageIds) ||
      !provenance.sourceToolMessageIds.every((id) => typeof id === 'string')
    ) {
      throw new Error(`Intervention continuation provenance missing: ${operationId}`);
    }
    if (
      preparation?.state !== 'ready' ||
      preparation.resolutionRequestId !== provenance.resolutionRequestId ||
      typeof preparation.stepIndex !== 'number' ||
      !Number.isSafeInteger(preparation.stepIndex) ||
      preparation.stepIndex < 0
    ) {
      throw new Error(`Intervention continuation is not ready to schedule: ${operationId}`);
    }
    const stepIndex = preparation.stepIndex;
    const deduplicationId = deriveAgentInterventionQueueDeduplicationId(operationId, stepIndex);
    if (preparation.deduplicationId !== deduplicationId) {
      throw new Error(`Intervention continuation dedupe provenance conflict: ${operationId}`);
    }
    const operation = await this.agentOperationModel.findById(operationId);
    if (
      !operation ||
      !matchesAgentInterventionContinuationProvenance(
        operation.metadata?.agentInterventionContinuation,
        provenance as {
          resolutionRequestId: string;
          sourceOperationId: string;
          sourceToolMessageIds: string[];
        },
      )
    ) {
      throw new Error(`Intervention continuation durable provenance conflict: ${operationId}`);
    }
    const durablePreparation = operation.metadata?.agentInterventionPreparation as
      | {
          deduplicationId?: unknown;
          resolutionRequestId?: unknown;
          state?: unknown;
          stepIndex?: unknown;
        }
      | undefined;
    if (
      durablePreparation &&
      (durablePreparation.state !== 'ready' ||
        durablePreparation.resolutionRequestId !== provenance.resolutionRequestId ||
        durablePreparation.stepIndex !== stepIndex ||
        durablePreparation.deduplicationId !== deduplicationId)
    ) {
      throw new Error(`Intervention continuation durable preparation conflict: ${operationId}`);
    }
    if (!durablePreparation) {
      const persisted = await this.agentOperationModel.recordAgentInterventionPreparation(
        operationId,
        {
          deduplicationId,
          resolutionRequestId: provenance.resolutionRequestId,
          state: 'ready',
          stepIndex,
        },
      );
      if (!persisted) {
        throw new Error(`Failed to backfill intervention preparation: ${operationId}`);
      }
    }
    const dispatchMarker = operation.metadata?.agentInterventionDispatch as
      | {
          deduplicationId?: unknown;
          messageId?: unknown;
          resolutionRequestId?: unknown;
          state?: unknown;
        }
      | undefined;
    if (dispatchMarker) {
      if (
        dispatchMarker.state !== 'scheduled' ||
        dispatchMarker.resolutionRequestId !== provenance.resolutionRequestId ||
        dispatchMarker.deduplicationId !== deduplicationId
      ) {
        throw new Error(`Intervention continuation dispatch marker conflict: ${operationId}`);
      }
      return 'already_started';
    }
    if (!this.queueService) {
      throw new Error(`Cannot schedule intervention continuation ${operationId}`);
    }

    // Missing provider ACK is never inferred from `state.status`: a worker may
    // have raced the HTTP response and advanced this state to running/terminal.
    // Re-publish with the same provider dedupe key to recover the ACK without a
    // second actual delivery, then persist the authoritative dispatch marker.
    const messageId = await this.queueService.scheduleMessage({
      context: (state as AgentState & { initialContext: AgentRuntimeContext }).initialContext,
      deduplicationId,
      delay: 0,
      endpoint: `${this.baseURL}/run`,
      operationId,
      priority: 'high',
      retryDelay:
        typeof state.metadata?.queueRetryDelay === 'string'
          ? state.metadata.queueRetryDelay
          : undefined,
      retries:
        typeof state.metadata?.queueRetries === 'number' ? state.metadata.queueRetries : undefined,
      stepIndex,
    });
    await this.persistInterventionDispatchAck({
      deduplicationId,
      messageId,
      operationId,
      resolutionRequestId: provenance.resolutionRequestId,
    });

    return 'scheduled';
  }

  private async persistInterventionDispatchAck(params: {
    deduplicationId: string;
    messageId: string;
    operationId: string;
    resolutionRequestId: string;
  }): Promise<void> {
    const marker = {
      deduplicationId: params.deduplicationId,
      messageId: params.messageId,
      resolutionRequestId: params.resolutionRequestId,
      scheduledAt: new Date().toISOString(),
      state: 'scheduled' as const,
    };
    const persisted = await this.agentOperationModel.recordAgentInterventionDispatch(
      params.operationId,
      marker,
    );
    if (!persisted) {
      throw new Error(`Failed to persist intervention queue ACK: ${params.operationId}`);
    }
  }

  /**
   * Terminate an Agent Share visitor run whose authorization was revoked
   * mid-flight (see the per-step check in `executeStep`).
   *
   * Persists `interrupted` onto the already-loaded state — the same terminal
   * status a visitor's own Stop produces — so the client's stream settles
   * normally instead of hanging. Falls back to `interruptOperation` when no
   * state was readable. A persistence failure is logged, never rethrown: the
   * run must stop regardless of whether the terminal status could be written.
   *
   * The completion lifecycle (`emitSignalEvents` + `dispatchHooks`) must run
   * here too: this abort short-circuits `executeStep` before `runtime.step()`,
   * so no downstream path is left to persist the terminal status. Without it
   * `saveAgentState` would only update the runtime-state cache and publish the
   * terminal stream event, leaving `agent_operations` stuck on `running` —
   * which `TopicModel.tryReserveTaskCallback` then reads as a live run and
   * blocks the visitor's next send on that topic for the abandoned-run TTL.
   */
  private async buildShareAbortResult(
    operationId: string,
    state: AgentState | null | undefined,
  ): Promise<AgentExecutionResult> {
    log('[%s] Aborting share visitor run — the share is no longer authorized', operationId);

    try {
      if (state) {
        const interruptedState: AgentState = {
          ...state,
          lastModified: new Date().toISOString(),
          status: 'interrupted',
        };
        await this.coordinator.saveAgentState(operationId, interruptedState);

        await this.completionLifecycle.emitSignalEvents(
          operationId,
          interruptedState,
          'interrupted',
        );
        await this.completionLifecycle.dispatchHooks(operationId, interruptedState, 'interrupted');
      } else {
        await this.interruptOperation(operationId);
      }
    } catch (error) {
      log(
        '[%s] Failed to persist interrupted state for an aborted share run: %O',
        operationId,
        error,
      );
    }

    return {
      nextStepScheduled: false,
      state: { status: 'interrupted' },
      stepResult: null,
      success: false,
    };
  }

  // ==================== Operation Management ====================

  /**
   * Create a new Agent operation
   */
  async createOperation(params: OperationCreationParams): Promise<OperationCreationResult> {
    const {
      activeDeviceId,
      activeDeviceScope,
      operationId,
      initialContext,
      agentConfig,
      agentGroup,
      agentShareVisitor,
      modelRuntimeConfig,
      userId,
      autoStart = true,
      stream,
      initialMessages = [],
      interventionResolution,
      onInterventionPrepared,
      appContext,
      toolSet,
      hooks,
      userInterventionConfig,
      queueRetries,
      queueRetryDelay,
      searchDecision,
      botContext,
      botPlatformContext,
      deviceAccessPolicy,
      discordContext,
      evalContext,
      evalRuntime,
      enableExpertise,
      expertise,
      executionPlan,
      maxSteps,
      userMemory,
      deviceSystemInfo,
      operationSkillSet,
      parentOperationId,
      signal,
      userTimezone,
      initialStepCount = 0,
      workspaceId,
    } = params;

    // Persist initial agent_operations row. CompletionLifecycle owns both
    // ends of the persistence lifecycle (start row here, terminal update
    // in dispatchHooks) and swallows DB errors so runtime startup is never
    // blocked.
    const operationStartPersisted = await this.completionLifecycle.recordStart({
      agentId: appContext?.agentId ?? null,
      appContext: {
        defaultTaskAssigneeAgentId: appContext?.defaultTaskAssigneeAgentId,
        documentId: appContext?.documentId,
        groupId: appContext?.groupId,
        scope: appContext?.scope,
        sessionId: appContext?.sessionId,
        sourceMessageId: appContext?.sourceMessageId,
      },
      chatGroupId: appContext?.groupId ?? null,
      maxSteps,
      // Persist the Agent Signal run marker on the operation row so server-side
      // self-iteration tools can read it back (metadata.agentSignal) at tool-call
      // time — the trimmed appContext above intentionally drops it.
      ...(appContext?.agentSignal || interventionResolution
        ? {
            metadata: {
              ...(appContext?.agentSignal ? { agentSignal: appContext.agentSignal } : {}),
              ...(interventionResolution
                ? { agentInterventionContinuation: interventionResolution }
                : {}),
            },
          }
        : {}),
      model: modelRuntimeConfig?.model,
      modelRuntimeConfig,
      operationId,
      parentOperationId: parentOperationId ?? null,
      provider: modelRuntimeConfig?.provider,
      taskId: appContext?.taskId ?? null,
      threadId: appContext?.threadId ?? null,
      topicId: appContext?.topicId ?? null,
      trigger: appContext?.trigger,
    });
    if (interventionResolution && !operationStartPersisted) {
      throw new Error(
        `Failed to durably persist intervention continuation ${operationId} before dispatch`,
      );
    }

    if (interventionResolution) {
      const durableOperation = await this.agentOperationModel.findById(operationId);
      const persistedProvenance = durableOperation?.metadata?.agentInterventionContinuation;
      if (
        !durableOperation ||
        !matchesAgentInterventionContinuationProvenance(persistedProvenance, interventionResolution)
      ) {
        throw new Error(`Intervention continuation operation identity conflict: ${operationId}`);
      }
    }

    const operationToolSet = toolSet;
    let operationCreated = false;
    let hooksRegistered = false;

    try {
      throwIfAborted(signal, 'Agent execution aborted before operation startup');

      const memories = userMemory?.memories;
      log(
        '[%s] Creating new operation (autoStart: %s) with params: model=%s, provider=%s, tools=%d, messages=%d, manifests=%d, memory=%s',
        operationId,
        autoStart,
        agentConfig?.model,
        agentConfig?.provider,
        operationToolSet.tools?.length ?? 0,
        initialMessages.length,
        operationToolSet.manifestMap ? Object.keys(operationToolSet.manifestMap).length : 0,
        memories
          ? `{contexts:${memories.contexts?.length ?? 0},experiences:${memories.experiences?.length ?? 0},preferences:${memories.preferences?.length ?? 0},identities:${memories.identities?.length ?? 0},activities:${memories.activities?.length ?? 0},persona:${memories.persona ? 'yes' : 'no'}}`
          : 'none',
      );

      // Initialize operation state - create state before saving
      const activatableToolIds = new Set(operationToolSet.activatableToolIds ?? []);
      const restoredActivatedToolIds = extractActivatedToolIdsFromMessages(initialMessages)?.filter(
        (id) => activatableToolIds.has(id),
      );
      const activatedStepTools = restoredActivatedToolIds?.length
        ? restoredActivatedToolIds.map((id) => ({
            activatedAtStep: initialStepCount,
            id,
            manifest: operationToolSet.manifestMap[id],
            source: 'discovery' as const,
          }))
        : undefined;

      const initialState = {
        activatedStepTools,
        createdAt: new Date().toISOString(),
        enableExpertise,
        expertise,
        // Store initialContext for executeSync to use
        initialContext,
        lastModified: new Date().toISOString(),
        // Use the passed initial messages
        messages: initialMessages,
        metadata: {
          activeDeviceId,
          activeDeviceScope,
          agentConfig,
          agentGroup,
          agentShareVisitor,
          botContext,
          botPlatformContext,
          deviceAccessPolicy,
          deviceSystemInfo,
          discordContext,
          evalContext,
          evalRuntime,
          executionPlan,
          ...(interventionResolution
            ? { agentInterventionContinuation: interventionResolution }
            : {}),
          // need be removed
          modelRuntimeConfig,
          queueRetries,
          queueRetryDelay,
          ...(searchDecision && { searchDecision }),
          stream,
          operationSkillSet,
          userId,
          userMemory,
          userTimezone,
          workingDirectory: agentConfig?.chatConfig?.runtimeEnv?.workingDirectory,
          workspaceId,
          ...appContext,
        },
        maxSteps,
        // modelRuntimeConfig at state level for executor fallback
        modelRuntimeConfig,
        operationId,
        operationToolSet,
        status: 'idle',
        stepCount: initialStepCount,
        // Backward-compat: resolved tool fields read by RuntimeExecutors
        toolExecutorMap: operationToolSet.executorMap,
        toolManifestMap: operationToolSet.manifestMap,
        toolSourceMap: operationToolSet.sourceMap,
        tools: operationToolSet.tools,
        // User intervention config for headless mode in async tasks
        userInterventionConfig,
      } as Partial<AgentState>;

      // Use coordinator to create operation, automatically sends initialization event.
      // For an in-group broadcast/speak member, mirror its Gateway stream events
      // onto the supervisor op's channel (parentOperationId) so they flow down the
      // supervisor's existing WebSocket — the client subscribes to one connection,
      // not one per member (single-connection multiplexing).
      const mirrorToOperationId =
        appContext?.orchestrationRole === 'member' ? (parentOperationId ?? undefined) : undefined;
      await this.coordinator.createAgentOperation(operationId, {
        agentConfig,
        // Persisted so a queue worker that never ran this op's init still
        // applies the owner-configured visitor redaction policy instead of the
        // fail-closed full strip. See `gatewayVisitorRedaction.ts`.
        visitorRedaction: agentShareVisitor
          ? {
              showErrorDetails: agentShareVisitor.showErrorDetails,
              showModelInfo: agentShareVisitor.showModelInfo,
            }
          : undefined,
        mirrorToOperationId,
        modelRuntimeConfig,
        // Share-visitor runs execute as the creator (`userId`) but stream only
        // to the visitor — the gateway registers the WS channel under this id.
        streamOwnerUserId: agentShareVisitor?.visitorUserId,
        userId,
        workspaceId: this.workspaceId,
      });
      operationCreated = true;

      // Save initial state
      await this.coordinator.saveAgentState(operationId, initialState as any);

      // Register external hooks
      if (hooks && hooks.length > 0) {
        hookDispatcher.register(operationId, hooks);
        hooksRegistered = true;

        // Persist webhook configs to state metadata for production mode
        const serializedHooks = hookDispatcher.getSerializedHooks(operationId);
        if (serializedHooks && serializedHooks.length > 0) {
          const currentState = await this.coordinator.loadAgentState(operationId);
          if (currentState) {
            await this.coordinator.saveAgentState(operationId, {
              ...currentState,
              metadata: {
                ...currentState.metadata,
                _hooks: serializedHooks,
              },
            });
          }
        }
      }

      if (interventionResolution) {
        const preparedState = await this.coordinator.loadAgentState(operationId);
        if (!preparedState) {
          throw new Error(`Intervention continuation state disappeared: ${operationId}`);
        }
        const preparation = {
          deduplicationId: deriveAgentInterventionQueueDeduplicationId(
            operationId,
            initialStepCount,
          ),
          resolutionRequestId: interventionResolution.resolutionRequestId,
          state: 'ready' as const,
          stepIndex: initialStepCount,
        };
        await this.coordinator.saveAgentState(operationId, {
          ...preparedState,
          metadata: {
            ...preparedState.metadata,
            agentInterventionPreparation: preparation,
          },
        });
        const preparationPersisted =
          await this.agentOperationModel.recordAgentInterventionPreparation(
            operationId,
            preparation,
          );
        if (!preparationPersisted) {
          throw new Error(
            `Failed to persist intervention continuation preparation: ${operationId}`,
          );
        }
        onInterventionPrepared?.();
      }

      throwIfAborted(signal, 'Agent execution aborted before first step scheduling');

      let messageId: string | undefined;
      let autoStarted = false;

      if (autoStart && this.queueService) {
        const deduplicationId = interventionResolution
          ? deriveAgentInterventionQueueDeduplicationId(operationId, initialStepCount)
          : undefined;
        // Both local and queue modes use scheduleMessage
        // LocalQueueServiceImpl uses setTimeout + callback mechanism
        // QStashQueueServiceImpl schedules HTTP requests
        messageId = await this.queueService.scheduleMessage({
          context: initialContext,
          deduplicationId,
          delay: 50, // Short delay for startup
          endpoint: `${this.baseURL}/run`,
          operationId,
          priority: 'high',
          retryDelay: queueRetryDelay,
          retries: queueRetries,
          stepIndex: initialStepCount,
        });
        if (interventionResolution && deduplicationId) {
          await this.persistInterventionDispatchAck({
            deduplicationId,
            messageId,
            operationId,
            resolutionRequestId: interventionResolution.resolutionRequestId,
          });
        }
        autoStarted = true;
        log('[%s] Scheduled first step (messageId: %s)', operationId, messageId);
      }

      if (!autoStarted) {
        log('[%s] Created operation without auto-start', operationId);
      }

      return { autoStarted, messageId, operationId, success: true };
    } catch (error) {
      if (isAbortError(error)) {
        if (hooksRegistered) {
          hookDispatcher.unregister(operationId);
        }

        if (operationCreated) {
          try {
            await this.coordinator.deleteAgentOperation(operationId);
          } catch (cleanupError) {
            console.error('Failed to cleanup aborted operation %s: %O', operationId, cleanupError);
          }
        }

        log('[%s] Operation creation aborted before scheduling', operationId);
        throw error;
      }

      console.error('Failed to create operation %s: %O', operationId, error);
      throw error;
    }
  }

  /**
   * Query the canonical UIChatMessage[] snapshot for the active topic — the
   * same shape the `message.getMessages` trpc lambda returns to the client.
   * Attached to step_start / agent_runtime_end stream events so the client
   * can use the pushed payload directly instead of refetching from DB.
   *
   * Returns undefined when the topic isn't known yet (e.g. very early in
   * bootstrap before the topic row has been committed) so callers can skip
   * the `uiMessages` field entirely instead of pushing an empty array.
   */
  async queryUiMessages(
    agentState: AgentState,
    options?: {
      /**
       * Skip the Work-summary assembly for mid-stream (step_start) snapshots —
       * each step would otherwise re-run the per-type Work queries. Terminal
       * (agent_runtime_end) snapshots keep works so the settled message list
       * carries the round's Work chips. The client preserves previously
       * rendered works when applying a skipped snapshot (`preserveWorks`).
       */
      skipWorks?: boolean;
    },
  ): Promise<UIChatMessage[] | undefined> {
    const agentId: string | undefined = agentState?.metadata?.agentId;
    const topicId: string | undefined = agentState?.metadata?.topicId;
    // groupId scopes group conversations. Without it the query falls into the
    // standard branch (`groupId IS NULL`) and returns ZERO group messages, so
    // the step_start uiMessages snapshot would be empty and clobber the client.
    const groupId: string | undefined = agentState?.metadata?.groupId;
    // threadId scopes a subtopic run. Without it the snapshot is the topic's
    // MAIN conversation, and the client writes that into the thread's bucket at
    // step_start / agent_runtime_end — wiping the turn the run just produced, so
    // the subtopic panel falls back to showing the main conversation.
    const threadId: string | undefined = agentState?.metadata?.threadId ?? undefined;
    if (!agentId || !topicId) return undefined;

    try {
      return await this.messageService.queryMessages(
        {
          agentId,
          groupId,
          skipWorks: options?.skipWorks,
          threadId,
          topicId,
        },
        // The run's own topic is already resolved and authorized; an agent-share
        // visitor run executes under the CREATOR's identity, so without this the
        // creator-facing exclusion in `MessageModel.query()` returns an EMPTY
        // snapshot for the visitor's topic, and the client applies it as the
        // terminal Source of Truth — wiping the conversation the run just
        // produced. Visitor-facing redaction of the pushed snapshot happens in
        // `GatewayStreamNotifier`.
        { allowShareVisitor: true },
      );
    } catch (error) {
      // Stream events must never fail the step. If the DB hiccups, fall back
      // to letting the client refresh as before.
      console.error('[queryUiMessages] Failed to load uiMessages snapshot: %O', error);
      return undefined;
    }
  }

  /**
   * Execute Agent step
   */
  async executeStep(params: AgentExecutionParams): Promise<AgentExecutionResult> {
    const {
      operationId,
      stepIndex,
      context,
      humanInput,
      approvedToolCall,
      rejectionReason,
      rejectAndContinue,
      resumeAsyncTool,
      finishAfterAsyncTool,
      groupMemberTimeout,
      toolMessageId,
      verifyAsyncToolBarrier,
      asyncToolVerifyAttempt,
      externalRetryCount = 0,
      lockRetryAttempt = 0,
    } = params;

    // Group member timeout watchdog: enforce a member's deadline without claiming
    // the step lock. No-op if the member already finished; otherwise interrupt it
    // and bridge a `timeout` completion so the parked supervisor resumes/finishes.
    if (groupMemberTimeout) {
      return this.handleGroupMemberTimeout(groupMemberTimeout);
    }

    // Redis keeps the resumable step state, but the durable operation row is
    // the authority for cancellation/recovery. A queued QStash delivery can
    // outlive a crashed process and arrive after Goal recovery has atomically
    // marked that operation interrupted. ACK it without touching the old
    // topic; otherwise the abandoned attempt can finish concurrently with its
    // replacement and submit a second Acceptance run.
    try {
      const durableOperation = await this.agentOperationModel.findById(operationId);
      if (
        durableOperation &&
        ['done', 'error', 'interrupted', 'abandoned'].includes(durableOperation.status)
      ) {
        log(
          '[%s][%d] Skipping delivery for terminal durable operation (%s)',
          operationId,
          stepIndex,
          durableOperation.status,
        );
        return {
          nextStepScheduled: false,
          state: {
            status:
              durableOperation.status === 'abandoned' ? 'interrupted' : durableOperation.status,
          },
          stepResult: null,
          success: true,
        };
      }
    } catch (error) {
      // Preserve runtime availability when the durable store has a transient
      // read failure. The step lock and normal persistence path still apply.
      log('[%s][%d] Durable operation status check failed: %O', operationId, stepIndex, error);
    }

    // Watchdog re-check for a parked async-tool wait: re-run the barrier + CAS
    // without claiming the step lock or executing anything. Idempotent — the
    // CAS guarantees at most one real resume regardless of how many checks run.
    // Opt back into `scheduleVerifyOnHold` with the next attempt so an
    // unsatisfied barrier re-arms (bounded backoff) instead of giving up after
    // a single shot — bounded watchdog retry ensures transient misses are recovered.
    if (verifyAsyncToolBarrier) {
      const attempt = asyncToolVerifyAttempt ?? 1;
      log(
        '[%s][%d] Running async-tool barrier verify (attempt %d)',
        operationId,
        stepIndex,
        attempt,
      );
      const resumed = await this.tryResumeParentFromAsyncTool(
        { parentOperationId: operationId },
        { scheduleVerifyOnHold: true, verifyAttempt: attempt + 1 },
      );
      return {
        nextStepScheduled: resumed,
        state: {},
        stepResult: null,
        success: true,
      };
    }

    // ===== Distributed lock: prevent duplicate execution from QStash retries =====
    const stepLockOwner = createStepLockOwner(operationId, stepIndex);
    const claimed = await this.coordinator.tryClaimStep(
      operationId,
      stepIndex,
      STEP_LOCK_TTL_SECONDS,
      stepLockOwner,
    );
    if (!claimed) {
      let currentState: AgentState | null | undefined = null;
      try {
        currentState = await this.coordinator.loadAgentState(operationId);
      } catch (error) {
        log(
          '[%s][%d] Failed to load state while handling step lock conflict: %O',
          operationId,
          stepIndex,
          error,
        );
      }

      const currentStepCount = currentState?.stepCount;
      if (currentState && typeof currentStepCount === 'number' && currentStepCount > stepIndex) {
        if (
          this.shouldReplayPendingInterventionLifecycle(currentState, stepIndex, externalRetryCount)
        ) {
          // This is a retry of a completed human-approval step whose Review
          // lifecycle did not finish. Do not ACK it while another delivery still
          // owns the step lock: once that owner releases the lock, QStash must
          // redeliver so the lifecycle-only replay below can publish the Review.
          log(
            '[%s][%d] Pending intervention lifecycle retry is still locked; requesting redelivery',
            operationId,
            stepIndex,
          );
          return {
            locked: true,
            nextStepScheduled: false,
            state: currentState,
            success: false,
          };
        }

        log(
          '[%s][%d] Step lock conflict is stale (stepCount=%d), skipping',
          operationId,
          stepIndex,
          currentStepCount,
        );
        return {
          nextStepScheduled: false,
          state: currentState,
          stepResult: null,
          success: true,
        };
      }

      // The lock is held by a live step of this operation, and this delivery is
      // not a stale duplicate — it still has to run once the holder is done.
      //
      // Don't lean on the queue's own retry budget for that wait: the lock is
      // heartbeat-refreshed for as long as the holding step runs (unbounded),
      // while the budget is a handful of fixed-delay retries. A step that runs
      // longer than the budget therefore exhausts it and the delivery is
      // dead-lettered — the step it carried is then never executed. Re-queue a
      // fresh delivery on our own bounded backoff instead, and ACK this one.
      //
      // The re-delivery has to carry this delivery's own resume/intervention
      // payload: a human-intervention resume (`processHumanIntervention`) or an
      // async-tool resume (`tryResumeParentFromAsyncTool`) can lose the lock
      // race too, and re-queueing only the retry counter would run a plain step
      // once the lock clears — silently dropping the approval / human input, or
      // leaving a parked operation parked forever. Undefined fields drop out of
      // the JSON body, so unrelated deliveries still send just the counter.
      const nextLockRetryAttempt = lockRetryAttempt + 1;
      if (this.queueService && nextLockRetryAttempt <= STEP_LOCK_RETRY_MAX_ATTEMPTS) {
        const delay = stepLockRetryDelayMs(nextLockRetryAttempt);
        log(
          '[%s][%d] Step lock conflict — re-queueing attempt %d/%d in %dms',
          operationId,
          stepIndex,
          nextLockRetryAttempt,
          STEP_LOCK_RETRY_MAX_ATTEMPTS,
          delay,
        );

        try {
          await this.queueService.scheduleMessage({
            context,
            delay,
            endpoint: `${this.baseURL}/run`,
            operationId,
            payload: {
              approvedToolCall,
              finishAfterAsyncTool,
              humanInput,
              lockRetryAttempt: nextLockRetryAttempt,
              rejectAndContinue,
              rejectionReason,
              resumeAsyncTool,
              toolMessageId,
            },
            priority: 'high',
            retryDelay:
              typeof currentState?.metadata?.queueRetryDelay === 'string'
                ? currentState.metadata.queueRetryDelay
                : undefined,
            retries:
              typeof currentState?.metadata?.queueRetries === 'number'
                ? currentState.metadata.queueRetries
                : undefined,
            stepIndex,
          });

          return {
            locked: true,
            lockRescheduled: true,
            nextStepScheduled: true,
            state: {},
            success: true,
          };
        } catch (error) {
          // Fall through to the retryable response so the delivery isn't lost.
          log(
            '[%s][%d] Failed to re-queue after step lock conflict: %O',
            operationId,
            stepIndex,
            error,
          );
        }
      }

      log(
        '[%s][%d] Step lock conflict — another instance is executing this step, returning locked',
        operationId,
        stepIndex,
      );
      return {
        locked: true,
        nextStepScheduled: false,
        state: {},
        success: false,
      };
    }

    await this.agentOperationModel.touchRunning(operationId).catch((error) => {
      log('[%s][%d] Operation lease refresh failed: %O', operationId, stepIndex, error);
    });
    const stopStepLockHeartbeat = this.startStepLockHeartbeat(
      operationId,
      stepIndex,
      stepLockOwner,
    );

    // Hoisted so the shared `finally` can stop it on every exit path — an
    // orphaned interval would keep polling Redis for a step that is long gone.
    let stepAbortPoll: ReturnType<typeof setTimeout> | undefined;
    // Clearing the timeout is not enough: a poll already awaiting the state read
    // would schedule the next one after the step is gone, leaking a loop that
    // re-reads the store forever for a finished operation.
    let stepAbortPollStopped = false;

    // Hoisted so the error-path snapshot finalize can record an
    // approximate startedAt for the failing step. The inner `startAt` at the
    // runtime.step() call site stays as the authoritative start for the
    // success path.
    const stepStartAt = Date.now();

    // OTel invoke_agent span. Wraps the entire step body so child spans
    // (chat / execute_tool / context_engineering) auto-nest via the active
    // context. Started with minimal attrs; agent/model/topic are added once
    // agentState is loaded.
    const invokeAgentSpan = agentRuntimeTracer.startSpan(invokeAgentSpanName(), {
      attributes: buildInvokeAgentAttributes({ operationId, stepIndex }),
    });
    const invokeAgentCtx = otelTrace.setSpan(otelContext.active(), invokeAgentSpan);

    try {
      return await otelContext.with(invokeAgentCtx, async () => {
        log('[%s][%d] Start step executing...', operationId, stepIndex);

        // Load agent state BEFORE publishing step_start so we can attach the
        // canonical UIChatMessage snapshot to the event payload. step_start
        // fires after the previous step's DB writes are awaited durable, so
        // the snapshot query here reflects strongly-consistent state — that's
        // the contract that lets the client treat the pushed uiMessages as
        // the source of truth instead of doing its own refetch.
        const agentState = await this.coordinator.loadAgentState(operationId);

        if (!agentState) {
          throw new Error(`Agent state not found for operation ${operationId}`);
        }

        // A parked approval step is already durable before its generic Review
        // is published. When that final Review write fails, the request returns
        // non-2xx and QStash retries this SAME step with `upstash-retried > 0`.
        // The runtime state now has stepCount > stepIndex, so the ordinary stale
        // delivery guard below would ACK it and permanently strand the Review.
        // Replay only the idempotent completion lifecycle: never run beforeStep,
        // runtime.step (LLM/tools), afterStep, or saveStepResult again.
        if (
          agentState.stepCount > stepIndex &&
          this.shouldReplayPendingInterventionLifecycle(agentState, stepIndex, externalRetryCount)
        ) {
          agentState.metadata = {
            ...agentState.metadata,
            externalRetryCount,
          };

          const reason = 'waiting_for_human' as const;
          const completionSignalEvents = await this.completionLifecycle.emitSignalEvents(
            operationId,
            agentState,
            reason,
          );
          await this.completionLifecycle.dispatchHooks(operationId, agentState, reason);
          await this.recordInterventionLifecycleCompletion(operationId, agentState, stepIndex);
          await this.traceRecorder.finalize(operationId, {
            appendEventsToLastStep: completionSignalEvents,
            completionReason: reason,
            state: agentState,
          });

          log('[%s][%d] Replayed pending intervention lifecycle', operationId, stepIndex);
          return {
            nextStepScheduled: false,
            state: agentState,
            stepResult: null,
            success: true,
          };
        }

        const stepStartUiMessages = await this.queryUiMessages(agentState, { skipWorks: true });
        await this.streamManager.publishStreamEvent(operationId, {
          data: {
            ...(stepStartUiMessages !== undefined && { uiMessages: stepStartUiMessages }),
          },
          stepIndex,
          type: 'step_start',
        });

        agentState.metadata = {
          ...agentState.metadata,
          externalRetryCount,
        };

        // Rehydrate `messages` from the DB at every step entry. Each step is a
        // separate invocation that loads state fresh from Redis, so this makes
        // the DB the single source of truth for the conversation on every path
        // — not just the async-tool / human-intervention resumes that already
        // refresh below. With this in place the Redis-persisted state no longer
        // needs to carry the (potentially multi-MB) `messages` array, which is
        // what trips Upstash's 10MB single-request limit and drops the op.
        await this.rehydrateStateMessagesFromDB(agentState);

        // Enrich invoke_agent span with agent identity now that state is loaded.
        const stateAgentConfig = agentState.metadata?.agentConfig as
          { description?: string | null; title?: string | null } | undefined;
        const stateModel =
          agentState.modelRuntimeConfig?.model ?? agentState.metadata?.modelRuntimeConfig?.model;
        const stateProvider =
          agentState.modelRuntimeConfig?.provider ??
          agentState.metadata?.modelRuntimeConfig?.provider;
        invokeAgentSpan.updateName(invokeAgentSpanName(stateAgentConfig?.title ?? undefined));
        invokeAgentSpan.setAttributes(
          buildInvokeAgentAttributes({
            agentDescription: stateAgentConfig?.description ?? undefined,
            agentId: agentState.metadata?.agentId,
            agentName: stateAgentConfig?.title ?? undefined,
            conversationId: agentState.metadata?.topicId,
            operationId,
            provider: stateProvider,
            requestModel: stateModel,
            stepIndex,
          }),
        );

        // Layer 2 defense: catch extremely delayed retries that arrive after lock TTL expired
        if (agentState.stepCount > stepIndex) {
          log(
            '[%s][%d] Step already completed (stepCount=%d), skipping',
            operationId,
            stepIndex,
            agentState.stepCount,
          );
          return {
            nextStepScheduled: false,
            state: agentState,
            stepResult: null,
            success: true,
          };
        }

        // Early exit: skip step if operation is already in a terminal state
        // This prevents executing expensive LLM/tool calls after timeout or interruption
        if (
          agentState.status === 'interrupted' ||
          agentState.status === 'done' ||
          agentState.status === 'error'
        ) {
          log(
            '[%s][%d] Skipping step — operation already in terminal state: %s',
            operationId,
            stepIndex,
            agentState.status,
          );

          const reason = this.determineCompletionReason(agentState);

          await this.completionLifecycle.emitSignalEvents(operationId, agentState, reason);

          // Dispatch completion hooks so consumers (e.g., bot local-mode promise) can finalize
          await this.completionLifecycle.dispatchHooks(operationId, agentState, reason);

          return {
            nextStepScheduled: false,
            state: agentState,
            stepResult: null,
            success: true,
          };
        }

        // Agent Share: re-prove this visitor run's authorization on EVERY step.
        // A revocation only flips the `agent_shares` row — nothing tears down
        // an operation that was already created, so without this the run keeps
        // going under the creator's credentials/budget for the rest of its
        // (potentially very long) lifetime, and the visitor's own Stop button
        // has already stopped working (it re-resolves the now-private share and
        // gets FORBIDDEN). Re-checking here means a revocation cannot survive a
        // step boundary. See `AgentShareModel.isRunStillAuthorized`'s JSDoc for
        // why one query covers every revocation path (visibility flip — which
        // is what turning sharing off does — share delete, agent delete).
        if (this.delegate.verifyShareRunStillAuthorized) {
          const shareMarker = agentState.metadata?.agentShareVisitor as
            { agentId?: string; shareId?: string } | undefined;
          if (shareMarker?.agentId && shareMarker.shareId) {
            let stillAuthorized = false;
            try {
              stillAuthorized = await this.delegate.verifyShareRunStillAuthorized({
                agentId: shareMarker.agentId,
                shareId: shareMarker.shareId,
              });
            } catch (error) {
              // Fail closed: a read failure must not be read as "still
              // authorized". Falls through to the abort below with
              // `stillAuthorized` left `false`.
              log(
                '[%s][%d] Share run authorization re-check failed: %O',
                operationId,
                stepIndex,
                error,
              );
            }
            if (!stillAuthorized) {
              return this.buildShareAbortResult(operationId, agentState);
            }
          }
        }

        let beforeStepSignalEvents: Array<{ [key: string]: unknown; type: string }> = [];

        // Dispatch beforeStep hooks
        try {
          const beforeStepMetadata = agentState?.metadata || {};
          // Agent Share visitor runs execute AS the creator, so this
          // `userId`-scoped source event would record creator-owned Agent
          // Signal state for a turn an anonymous link visitor triggered — same
          // reasoning (and same predicate) as the completion-signal guard in
          // `CompletionLifecycle.emitSignalEvents`.
          const beforeStepSignalEmission = isAgentShareRun(beforeStepMetadata)
            ? undefined
            : await emitAgentSignalSourceEvent(
                {
                  payload: {
                    agentId: beforeStepMetadata?.agentId,
                    operationId,
                    serializedContext: undefined,
                    stepIndex,
                    topicId: beforeStepMetadata?.topicId,
                    turnCount: agentState?.stepCount || 0,
                  },
                  sourceId: `${operationId}:before:${stepIndex}`,
                  sourceType: 'runtime.before_step',
                },
                {
                  agentId: beforeStepMetadata?.agentId,
                  db: this.serverDB,
                  userId: beforeStepMetadata?.userId || this.userId,
                  workspaceId: this.workspaceId,
                },
                { ignoreError: true },
              );
          beforeStepSignalEvents = toAgentSignalSnapshotEvents(beforeStepSignalEmission);
          await hookDispatcher.dispatch(
            operationId,
            'beforeStep',
            {
              agentId: beforeStepMetadata?.agentId || '',
              finalState: agentState,
              operationId,
              stepIndex,
              steps: agentState?.stepCount || 0,
              userId: beforeStepMetadata?.userId || this.userId,
            },
            beforeStepMetadata._hooks,
          );
        } catch (hookError) {
          log('[%s] beforeStep hook dispatch error: %O', operationId, hookError);
        }

        // Per-step buffer for context engine input/output. Populated by the
        // `tracingContextEngine` callback passed into the executor context;
        // consumed by traceRecorder.appendStep below. Routing CE this way keeps
        // its heavy payload (agentDocuments, systemRole, …) out of
        // `stepResult.events` and therefore out of the Redis state pipeline.
        //
        // Context: contextEngine.input (agentDocuments) was ~2.7MB/step,
        // hitting Upstash Redis 10MB limit. Bypassing events keeps the heavy
        // payload in trace only, reducing per-step Redis state by ~500x.
        let contextEnginePayload: { input: unknown; output: unknown } | undefined;

        // Create Agent and Runtime instances
        // Use agentState.metadata which contains the full app context (topicId, agentId, etc.)
        // operationMetadata only contains basic fields (agentConfig, modelRuntimeConfig, userId)
        // Interrupts arrive as a flag on the persisted state — the request that
        // asked for the stop runs in a different invocation, so there is no
        // in-process controller to share. Poll for it while the step is alive
        // and cancel locally, otherwise a multi-minute tool would keep running
        // long after the user asked it to stop.
        const stepAbortController = new AbortController();
        // Serialized on purpose: `setInterval` would fire a new read without
        // waiting for the last one, so a slow or failing state store turns every
        // concurrent run into a growing pile of overlapping requests — the load
        // spikes exactly when the store is already struggling. Each read is
        // scheduled only after the previous one settles, and failures back off.
        let abortPollFailures = 0;
        const pollForAbort = async () => {
          try {
            const latest = await this.coordinator.loadAgentState(operationId);
            abortPollFailures = 0;
            if (latest?.status === 'interrupted') {
              stepAbortController.abort();
              return;
            }
          } catch (error) {
            abortPollFailures += 1;
            log('[%s][%d] Abort poll failed: %O', operationId, stepIndex, error);
          }

          if (stepAbortPollStopped || stepAbortController.signal.aborted) return;

          stepAbortPoll = setTimeout(
            pollForAbort,
            STEP_ABORT_POLL_INTERVAL_MS *
              Math.min(2 ** abortPollFailures, STEP_ABORT_POLL_MAX_BACKOFF),
          );
        };
        stepAbortPoll = setTimeout(pollForAbort, STEP_ABORT_POLL_INTERVAL_MS);

        const { runtime } = await this.createAgentRuntime({
          abortSignal: stepAbortController.signal,
          agentState,
          metadata: agentState?.metadata,
          operationId,
          stepIndex,
          tracingContextEngine: (input, output) => {
            contextEnginePayload = { input, output };
          },
        });

        // Handle human intervention
        let currentContext = context;
        let currentState = agentState;

        if (humanInput || approvedToolCall || rejectionReason) {
          const interventionResult = await this.humanIntervention.process(currentState, {
            approvedToolCall,
            humanInput,
            rejectAndContinue,
            rejectionReason,
            toolMessageId,
          });
          currentState = interventionResult.newState;
          currentContext = interventionResult.nextContext;
        }

        // Resume from a parked async-tool wait (server sub-agent completion
        // bridge). Every deferred tool has delivered its result by now, so clear
        // the pending set, refresh messages from the DB (to pick up the tool
        // results written out-of-band), and re-enter the LLM with them.
        if (resumeAsyncTool && currentState.status === 'waiting_for_async_tool') {
          const refreshed = await this.refreshMessagesFromDB(currentState);
          const pendingTools = (currentState.pendingToolsCalling ?? []) as ChatToolPayload[];
          const resumeParentMessageId = this.resolveAsyncToolResumeParentMessageId(
            refreshed,
            pendingTools,
          );
          currentState = structuredClone(currentState);
          currentState.messages = refreshed;
          currentState.pendingToolsCalling = [];
          currentState.status = 'running';
          currentState.interruption = undefined;
          currentState.lastModified = new Date().toISOString();
          currentContext = {
            payload: { parentMessageId: resumeParentMessageId },
            phase: 'user_input',
          } as AgentRuntimeContext;
          log(
            '[%s][%d] Resuming from async tool with %d messages (parent=%s)',
            operationId,
            stepIndex,
            refreshed.length,
            resumeParentMessageId,
          );
        }

        // Finish a parked supervisor op WITHOUT another LLM turn (group
        // orchestration skipCallSupervisor / delegate). Refresh messages so the
        // final group conversation is captured, transition straight to `done`,
        // and let the standard `!shouldContinue` finalization below record
        // completion + dispatch hooks. Skips runtime.step entirely.
        let forcedFinishState: AgentState | undefined;
        if (finishAfterAsyncTool && currentState.status === 'waiting_for_async_tool') {
          const refreshed = await this.refreshMessagesFromDB(currentState);
          currentState = structuredClone(currentState);
          currentState.messages = refreshed;
          currentState.pendingToolsCalling = [];
          currentState.status = 'done';
          currentState.interruption = undefined;
          currentState.lastModified = new Date().toISOString();
          forcedFinishState = currentState;
          log(
            '[%s][%d] Finishing parked supervisor op after async tool (%d messages)',
            operationId,
            stepIndex,
            refreshed.length,
          );
        }

        // Pre-step computation: extract device context from DB messages
        // Follows front-end computeStepContext pattern — computed at step boundary, not inside executors
        if (!currentState.metadata?.activeDeviceId) {
          const deviceContext = await this.computeDeviceContext(currentState);
          if (deviceContext && currentState.metadata) {
            currentState.metadata.activeDeviceId = deviceContext.activeDeviceId;
            currentState.metadata.devicePlatform = deviceContext.devicePlatform;
            currentState.metadata.deviceSystemInfo = deviceContext.deviceSystemInfo;
            log(
              '[%s][%d] Pre-step: device context computed from messages (deviceId: %s)',
              operationId,
              stepIndex,
              deviceContext.activeDeviceId,
            );
          }
        }

        // Execute step (skipped when force-finishing a parked supervisor op).
        const startAt = Date.now();
        logToolCallPc(operationId, stepIndex, 'post.runtime_step_entered', () => ({
          forcedFinish: Boolean(forcedFinishState),
          stateStatus: currentState.status,
        }));
        let stepResult = forcedFinishState
          ? { events: [], newState: forcedFinishState, nextContext: undefined }
          : await runtime.step(currentState, currentContext);

        // Inner runtime.step() catches model-runtime exceptions and stuffs the
        // raw error into newState.error without re-throwing — so the outer
        // catch at the bottom of this method never sees them. Normalize +
        // classify here so the raw error doesn't reach Redis state, the
        // success-path trace finalize, or `persistCompletion`'s JSONB write.
        if (stepResult.newState.error) {
          stepResult.newState.error = formatErrorForState(stepResult.newState.error);
        }
        logToolCallPc(operationId, stepIndex, 'post.runtime_step_returned', () => ({
          errorCategory: stepResult.newState.error?.category ?? null,
          errorRetryable: stepResult.newState.error?.retryable ?? null,
          nextContextPresent: stepResult.nextContext !== undefined,
          stateStatus: stepResult.newState.status,
        }));

        // Check if the operation was interrupted while the step was executing
        // (e.g., user clicked abort during a long LLM call)
        const latestState = await this.coordinator.loadAgentState(operationId);
        logToolCallPc(operationId, stepIndex, 'post.latest_state_loaded', () => ({
          interrupted: latestState?.status === 'interrupted',
        }));
        if (latestState?.status === 'interrupted') {
          // Stop can be persisted after a client-tool executor's last local
          // signal check but before this reconciliation read. If that executor
          // just returned a parked state, run the agent's existing abort path
          // once so every pending tool call gets a terminal row before the
          // interrupted state is saved.
          if (
            stepResult.newState.status === 'waiting_for_async_tool' &&
            stepResult.newState.pendingToolsCalling?.length &&
            currentContext
          ) {
            const interruptedState = structuredClone(stepResult.newState);
            interruptedState.status = 'interrupted';
            const abortContext: AgentRuntimeContext = {
              ...currentContext,
              payload: {
                ...(currentContext.payload as Record<string, unknown>),
                hasToolsCalling: true,
                toolsCalling: interruptedState.pendingToolsCalling,
              },
              phase: 'llm_result',
            };
            const abortResult = await runtime.step(interruptedState, abortContext);
            stepResult = {
              ...abortResult,
              events: [...stepResult.events, ...abortResult.events],
            };
          }

          stepResult.newState.status = 'interrupted';
          stepResult.newState.lastModified = new Date().toISOString();
          log('[%s][%d] Operation was interrupted during step execution', operationId, stepIndex);
        }

        // Decide whether to schedule next step (hoisted above the save: it also
        // gates the pre-snapshot file-Work registration below)
        const shouldContinue = this.shouldContinueExecution(
          stepResult.newState,
          stepResult.nextContext,
        );

        // Register entity-file Works BEFORE the terminal save: `saveStepResult`
        // publishes `agent_runtime_end`, whose `uiMessages` snapshot the client
        // adopts as the settled message list — the Work rows must exist by then
        // or the file-Work card stays absent until a manual refresh. Perceived
        // loading is not extended: for runs with entity edits the early
        // `visible_output_end` is suppressed (see `createAgentRuntime`), so
        // loading covers this export window by design. Idempotent — the
        // dispatchHooks backstop below no-ops via the state marker.
        if (!shouldContinue) {
          const preSaveReason = this.determineCompletionReason(stepResult.newState);
          if (preSaveReason === 'waiting_for_human') {
            stepResult.newState.metadata = {
              ...stepResult.newState.metadata,
              [INTERVENTION_LIFECYCLE_CHECKPOINT_KEY]: {
                state: 'pending',
                stepIndex,
              } satisfies InterventionLifecycleCheckpoint,
            };
          }

          // Success-like reasons ONLY — a `waiting_for_human` park must NOT
          // register because it is not a completed deliverable boundary. The
          // fresh approval continuation sees the complete authoritative
          // history and performs the terminal scan after the decision runs;
          // registering here would freeze pre-approval content too early.
          if (isSuccessLikeCompletionReason(preSaveReason)) {
            await this.completionLifecycle.registerFileWorks(operationId, stepResult.newState);
            logToolCallPc(operationId, stepIndex, 'post.file_works_registered', () => ({}));
          }
        }

        // Save state, coordinator will handle event sending automatically
        await this.coordinator.saveStepResult(operationId, {
          ...stepResult,
          executionTime: Date.now() - startAt,
          stepIndex, // placeholder
        });
        logToolCallPc(operationId, stepIndex, 'post.step_result_saved', () => ({
          stateStatus: stepResult.newState.status,
          stateStepCount: stepResult.newState.stepCount,
        }));

        let nextStepScheduled = false;

        // Publish step complete event
        await this.streamManager.publishStreamEvent(operationId, {
          data: {
            finalState: stepResult.newState,
            nextStepScheduled,
            stepIndex,
          },
          stepIndex,
          type: 'step_complete',
        });
        logToolCallPc(operationId, stepIndex, 'post.step_complete_published', () => ({}));

        await this.publishSubAgentProgress(stepResult.newState, stepIndex);

        // Build enhanced step completion log & presentation data
        const { presentation: stepPresentationData, summary: stepSummary } = buildStepPresentation(
          stepResult,
          Date.now() - startAt,
        );

        const { usage } = stepResult.newState;
        log(
          '[%s][%d] completed %s | total: %s tokens / $%s | llm×%d | tools×%d',
          operationId,
          stepIndex,
          stepSummary,
          formatTokenCount(stepPresentationData.totalTokens),
          stepPresentationData.totalCost.toFixed(4),
          usage?.llm?.apiCalls ?? 0,
          usage?.tools?.totalCalls ?? 0,
        );

        const toolsCalling = stepPresentationData.toolsCalling;
        const content = stepPresentationData.content;

        let afterStepSignalEvents: Array<{ [key: string]: unknown; type: string }> = [];

        // Dispatch afterStep hooks (enriched with step presentation + tracking data)
        try {
          const metadata = stepResult.newState?.metadata || {};
          const tracking = metadata._stepTracking || {};
          const elapsedMs = stepResult.newState?.createdAt
            ? Date.now() - new Date(stepResult.newState.createdAt).getTime()
            : undefined;
          const stepLabel = metadata?._stepLabel;

          // See the `runtime.before_step` guard above — same share-visitor
          // suppression at the sibling per-step emission.
          afterStepSignalEvents = toAgentSignalSnapshotEvents(
            isAgentShareRun(metadata)
              ? undefined
              : await emitAgentSignalSourceEvent(
                  {
                    payload: {
                      agentId: metadata?.agentId,
                      operationId,
                      serializedContext: undefined,
                      stepIndex,
                      topicId: metadata?.topicId,
                      turnCount: stepResult.newState?.stepCount || 0,
                    },
                    sourceId: `${operationId}:after:${stepIndex}`,
                    sourceType: 'runtime.after_step',
                  },
                  {
                    agentId: metadata?.agentId,
                    db: this.serverDB,
                    userId: metadata?.userId || this.userId,
                  },
                  { ignoreError: true },
                ),
          );

          await hookDispatcher.dispatch(
            operationId,
            'afterStep',
            {
              agentId: metadata?.agentId || '',
              content,
              elapsedMs,
              executionTimeMs: stepPresentationData.executionTimeMs,
              finalState: stepResult.newState,
              ...(stepLabel && { stepLabel }),
              lastLLMContent: tracking.lastLLMContent,
              lastToolsCalling: tracking.lastToolsCalling,
              operationId,
              reasoning: stepPresentationData.reasoning,
              shouldContinue,
              status: stepResult.newState?.status,
              stepCost: stepPresentationData.stepCost,
              stepIndex,
              stepType: stepPresentationData.stepType,
              steps: stepResult.newState?.stepCount || 0,
              thinking: stepPresentationData.thinking,
              toolCalls: stepResult.newState?.usage?.tools?.totalCalls,
              toolsCalling: stepPresentationData.toolsCalling,
              toolsResult: stepPresentationData.toolsResult,
              topicId: metadata?.topicId,
              totalCost: stepPresentationData.totalCost,
              totalInputTokens: stepPresentationData.totalInputTokens,
              totalOutputTokens: stepPresentationData.totalOutputTokens,
              totalSteps: stepPresentationData.totalSteps,
              totalTokens: stepPresentationData.totalTokens,
              totalToolCalls: (tracking.totalToolCalls ?? 0) + (toolsCalling?.length ?? 0),
              userId: metadata?.userId || this.userId,
            },
            metadata._hooks,
          );
        } catch (hookError) {
          log('[%s] afterStep hook dispatch error: %O', operationId, hookError);
        }

        await this.traceRecorder.appendStep(operationId, {
          afterStepSignalEvents,
          agentState,
          beforeStepSignalEvents,
          contextEngine: contextEnginePayload,
          currentContext,
          externalRetryCount,
          presentation: stepPresentationData,
          startedAt: startAt,
          stepIndex,
          stepResult,
        });

        // Update step tracking in state metadata for afterStep hooks (cross-step accumulator)
        const hasAfterStepHooks = stepResult.newState.metadata?._hooks?.some(
          (h: { type: string }) => h.type === 'afterStep',
        );
        logToolCallPc(operationId, stepIndex, 'post.trace_appended', () => ({}));
        logToolCallPc(operationId, stepIndex, 'post.route_selected', () => ({
          hasAfterStepHooks,
          nextContextPresent: stepResult.nextContext !== undefined,
          queueAvailable: Boolean(this.queueService),
          shouldContinue,
        }));
        if (hasAfterStepHooks && stepResult.newState.metadata) {
          const prevTracking = stepResult.newState.metadata._stepTracking || {};
          const newTotalToolCalls =
            (prevTracking.totalToolCalls ?? 0) + (toolsCalling?.length ?? 0);

          // Truncate content to 1800 chars to keep state small
          const truncatedContent = content
            ? content.length > 1800
              ? content.slice(0, 1800) + '...'
              : content
            : prevTracking.lastLLMContent;

          const updatedTracking = {
            lastLLMContent: truncatedContent,
            lastToolsCalling: toolsCalling || prevTracking.lastToolsCalling,
            totalToolCalls: newTotalToolCalls,
          };

          // Persist tracking state for next step
          stepResult.newState.metadata._stepTracking = updatedTracking;
          await this.coordinator.saveAgentState(operationId, stepResult.newState);
          logToolCallPc(operationId, stepIndex, 'post.step_tracking_saved', () => ({}));
        }

        if (shouldContinue && stepResult.nextContext && this.queueService) {
          const nextStepIndex = stepIndex + 1;
          const delay = this.calculateStepDelay(stepResult);
          const priority = this.calculatePriority(stepResult);

          await this.queueService.scheduleMessage({
            context: stepResult.nextContext,
            delay,
            endpoint: `${this.baseURL}/run`,
            operationId,
            priority,
            retryDelay:
              typeof stepResult.newState.metadata?.queueRetryDelay === 'string'
                ? stepResult.newState.metadata.queueRetryDelay
                : undefined,
            retries:
              typeof stepResult.newState.metadata?.queueRetries === 'number'
                ? stepResult.newState.metadata.queueRetries
                : undefined,
            stepIndex: nextStepIndex,
          });
          nextStepScheduled = true;
          logToolCallPc(operationId, stepIndex, 'post.next_step_scheduled', () => ({
            nextStepIndex,
          }));

          log('[%s][%d] Scheduled next step %d', operationId, stepIndex, nextStepIndex);
        }

        // Record final agent-level usage on the invoke_agent span. Done on every
        // step so partial trees (e.g. interrupted runs) still carry the
        // last-known token counters.
        invokeAgentSpan.setAttributes(
          buildInvokeAgentResultAttributes({
            inputTokens: stepResult.newState.usage?.llm?.tokens?.input,
            outputTokens: stepResult.newState.usage?.llm?.tokens?.output,
            stepCount: stepResult.newState.stepCount,
          }),
        );

        // Check if operation is complete
        if (!shouldContinue) {
          const reason = this.determineCompletionReason(stepResult.newState);
          invokeAgentSpan.setAttributes(
            buildInvokeAgentResultAttributes({ completionReason: reason }),
          );

          const completionSignalEvents = await this.completionLifecycle.emitSignalEvents(
            operationId,
            stepResult.newState,
            reason,
          );
          logToolCallPc(operationId, stepIndex, 'post.completion_signals', () => ({ reason }));

          // Dispatch completion hooks
          await this.completionLifecycle.dispatchHooks(operationId, stepResult.newState, reason);
          logToolCallPc(operationId, stepIndex, 'post.completion_hooks', () => ({ reason }));

          if (reason === 'waiting_for_human') {
            await this.recordInterventionLifecycleCompletion(
              operationId,
              stepResult.newState,
              stepIndex,
            );
          }

          // Park-time self-check: sub-agents are dispatched mid-step, so a
          // fast child can complete BEFORE this op's parked state/row were
          // persisted — its resume attempt then no-ops against the status
          // guard and nothing retries. Now that both the Redis state and the
          // `agent_operations` row (via dispatchHooks → persistCompletion)
          // say `waiting_for_async_tool`, re-run the barrier once to recover
          // any resume that raced the park.
          if (stepResult.newState.status === 'waiting_for_async_tool') {
            try {
              await this.tryResumeParentFromAsyncTool({ parentOperationId: operationId });
            } catch (selfCheckError) {
              log(
                '[%s][%d] Park-time async-tool self-check failed (non-fatal): %O',
                operationId,
                stepIndex,
                selfCheckError,
              );
            }
          }

          // Finalize tracing snapshot. The error catch below uses the same
          // recorder so propagated failures still write the canonical S3
          // snapshot instead of orphaning the partial ().
          const newStateError = stepResult.newState.error;
          await this.traceRecorder.finalize(operationId, {
            appendEventsToLastStep: completionSignalEvents,
            completionReason: reason,
            error: newStateError
              ? {
                  attribution: newStateError.attribution,
                  body: newStateError.body,
                  category: newStateError.category,
                  countAsFailure: newStateError.countAsFailure,
                  httpStatus: newStateError.httpStatus,
                  message:
                    this.completionLifecycle.extractErrorMessage(newStateError) ??
                    JSON.stringify(newStateError),
                  numericId: newStateError.numericId,
                  retryable: newStateError.retryable,
                  severity: newStateError.severity,
                  type: String(newStateError.type ?? newStateError.errorType ?? 'unknown'),
                }
              : undefined,
            state: stepResult.newState,
          });
          logToolCallPc(operationId, stepIndex, 'post.trace_finalized', () => ({ reason }));
        }

        return {
          nextStepScheduled,
          state: stepResult.newState,
          stepResult,
          success: true,
        };
      });
    } catch (error) {
      const isInterventionPersistenceFailure =
        error instanceof CriticalAgentInterventionPersistenceError;
      invokeAgentSpan.recordException(error as Error);
      invokeAgentSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      invokeAgentSpan.setAttributes(
        buildInvokeAgentResultAttributes({
          completionReason: isInterventionPersistenceFailure ? 'waiting_for_human' : 'error',
        }),
      );

      log('Step %d failed for operation %s: %O', stepIndex, operationId, error);

      // The runtime step and its waiting_for_human state are already durable;
      // only the idempotent generic Review publication failed. Turning this
      // infrastructure failure into an agent error would overwrite the parked
      // state/operation row and make the QStash redelivery terminal-short-circuit.
      // Preserve the parked state and propagate non-2xx so the completed-step
      // lifecycle replay above can retry Review persistence without repeating
      // any LLM or tool side effects.
      if (isInterventionPersistenceFailure) {
        log(
          '[%s][%d] Intervention Review persistence failed; keeping operation parked for retry',
          operationId,
          stepIndex,
        );
        throw error;
      }

      const formattedError = formatErrorForState(error);

      // Build error state — try loading current state from coordinator, but if that
      // also fails (e.g. Redis ECONNRESET), fall back to a minimal error state so
      // that completion callbacks and webhooks can still fire.
      let finalStateWithError: any;
      try {
        await this.streamManager.publishStreamEvent(operationId, {
          data: {
            error: formattedError.message,
            errorType: String(formattedError.type),
            phase: 'step_execution',
            stepIndex,
          },
          stepIndex,
          type: 'error',
        });
      } catch (publishError) {
        log(
          '[%s] Failed to publish error event (infra may be down): %O',
          operationId,
          publishError,
        );
      }

      try {
        const errorState = await this.coordinator.loadAgentState(operationId);
        finalStateWithError = {
          ...errorState!,
          error: formattedError,
          metadata: {
            ...errorState?.metadata,
            externalRetryCount,
          },
          status: 'error' as const,
          stepCount: errorState?.stepCount ?? stepIndex,
        };
      } catch (loadError) {
        log('[%s] Failed to load error state (infra may be down): %O', operationId, loadError);
        // Fallback: construct a minimal error state so callbacks still receive useful info
        finalStateWithError = {
          error: formattedError,
          metadata: { externalRetryCount },
          status: 'error' as const,
          stepCount: stepIndex,
        };
      }

      try {
        await this.coordinator.saveAgentState(operationId, finalStateWithError);
      } catch (saveError) {
        log('[%s] Failed to save error state (infra may be down): %O', operationId, saveError);
      }

      await this.completionLifecycle.emitSignalEvents(operationId, finalStateWithError, 'error');
      logToolCallPc(operationId, stepIndex, 'post.completion_signals', () => ({ reason: 'error' }));

      // Dispatch onComplete + onError hooks
      await this.completionLifecycle.dispatchHooks(operationId, finalStateWithError, 'error');
      logToolCallPc(operationId, stepIndex, 'post.completion_hooks', () => ({ reason: 'error' }));

      // Finalize the partial snapshot into the canonical S3 path so the
      // failed op is observable in the same place as a successful run.
      // Without this, propagated errors (e.g. markPersistFatal from
      // RuntimeExecutors) leave the partial as an orphan at
      // `_partial/<op>.json.zst` and the canonical
      // `agent-traces/<agentId>/<topicId>/<op>.json.zst` returns 404 — see
      // .
      //
      // `failedStep` synthesizes a step record for the failure because the
      // real step never reached `appendStepToPartial` — it threw before the
      // success path could push it. Without this synthetic step, the
      // snapshot's step count would lag the assistant message that
      // triggered the failing call.
      await this.traceRecorder.finalize(operationId, {
        completionReason: 'error',
        error: {
          attribution: formattedError.attribution,
          body: formattedError.body,
          category: formattedError.category,
          countAsFailure: formattedError.countAsFailure,
          httpStatus: formattedError.httpStatus,
          message: formattedError.message ?? String(formattedError.type),
          numericId: formattedError.numericId,
          retryable: formattedError.retryable,
          severity: formattedError.severity,
          type: String(formattedError.type),
        },
        failedStep: {
          startedAt: stepStartAt,
          stepIndex,
          stepType: formattedError.category === 'provider' ? 'call_llm' : 'call_tool',
        },
        state: finalStateWithError,
      });
      logToolCallPc(operationId, stepIndex, 'post.trace_finalized', () => ({ reason: 'error' }));

      throw error;
    } finally {
      invokeAgentSpan.end();
      stepAbortPollStopped = true;
      if (stepAbortPoll) clearTimeout(stepAbortPoll);
      stopStepLockHeartbeat();
      await this.coordinator.releaseStepLock(operationId, stepIndex, stepLockOwner);
    }
  }

  /**
   * Get operation status
   */
  async getOperationStatus(params: {
    historyLimit?: number;
    includeHistory?: boolean;
    operationId: string;
  }): Promise<OperationStatusResult | null> {
    const { operationId, includeHistory = false, historyLimit = 10 } = params;

    try {
      log('Getting operation status for %s', operationId);

      // Get current state and metadata
      const [currentState, operationMetadata] = await Promise.all([
        this.coordinator.loadAgentState(operationId),
        this.coordinator.getOperationMetadata(operationId),
      ]);

      // Operation may have expired or does not exist, return null
      if (!currentState || !operationMetadata) {
        log('Operation %s not found (may have expired)', operationId);
        return null;
      }

      // Get execution history (if needed)
      let executionHistory;
      if (includeHistory) {
        try {
          executionHistory = await this.coordinator.getExecutionHistory(operationId, historyLimit);
        } catch (error) {
          log('Failed to load execution history: %O', error);
          executionHistory = [];
        }
      }

      // Get recent stream events (for debugging)
      let recentEvents;
      if (includeHistory) {
        try {
          recentEvents = await this.streamManager.getStreamHistory(operationId, 20);
        } catch (error) {
          log('Failed to load recent events: %O', error);
          recentEvents = [];
        }
      }

      // Calculate operation statistics
      const stats = {
        lastActiveTime: operationMetadata.lastActiveAt
          ? Date.now() - new Date(operationMetadata.lastActiveAt).getTime()
          : 0,
        totalCost: currentState.cost?.total || 0,
        totalMessages: currentState.messages?.length || 0,
        totalSteps: currentState.stepCount || 0,
        uptime: operationMetadata.createdAt
          ? Date.now() - new Date(operationMetadata.createdAt).getTime()
          : 0,
      };

      return {
        currentState: {
          cost: currentState.cost,
          costLimit: currentState.costLimit,
          error: currentState.error,
          interruption: currentState.interruption,
          lastModified: currentState.lastModified,
          maxSteps: currentState.maxSteps,
          pendingHumanPrompt: currentState.pendingHumanPrompt,
          pendingHumanSelect: currentState.pendingHumanSelect,
          pendingToolsCalling: currentState.pendingToolsCalling,
          status: currentState.status,
          stepCount: currentState.stepCount,
          usage: currentState.usage,
        },
        executionHistory: executionHistory?.slice(0, historyLimit),
        hasError: currentState.status === 'error',
        isActive: currentState.status === 'running' || isParkedStatus(currentState.status),
        isCompleted: currentState.status === 'done',
        metadata: operationMetadata,
        needsHumanInput: currentState.status === 'waiting_for_human',
        operationId,
        recentEvents: recentEvents?.slice(0, 10),
        stats,
      };
    } catch (error) {
      log('Failed to get operation status for %s: %O', operationId, error);
      throw error;
    }
  }

  /**
   * Get list of pending human interventions
   */
  async getPendingInterventions(params: {
    operationId?: string;
    userId?: string;
  }): Promise<PendingInterventionsResult> {
    const { operationId, userId } = params;

    try {
      log('Getting pending interventions for operationId: %s, userId: %s', operationId, userId);

      let operations: string[] = [];

      if (operationId) {
        operations = [operationId];
      } else if (userId) {
        // Get all active operations for the user
        try {
          const activeOperations = await this.coordinator.getActiveOperations();

          // Filter operations belonging to this user
          const userOperations = [];
          for (const operation of activeOperations) {
            try {
              const metadata = await this.coordinator.getOperationMetadata(operation);
              if (metadata?.userId === userId) {
                userOperations.push(operation);
              }
            } catch (error) {
              log('Failed to get metadata for operation %s: %O', operation, error);
            }
          }
          operations = userOperations;
        } catch (error) {
          log('Failed to get active operations: %O', error);
          operations = [];
        }
      }

      // Check status of each operation
      const pendingInterventions = [];

      for (const operation of operations) {
        try {
          const [state, metadata] = await Promise.all([
            this.coordinator.loadAgentState(operation),
            this.coordinator.getOperationMetadata(operation),
          ]);

          if (state?.status === 'waiting_for_human') {
            const intervention: any = {
              lastModified: state.lastModified,
              modelRuntimeConfig: metadata?.modelRuntimeConfig,
              operationId: operation,
              status: state.status,
              stepCount: state.stepCount,
              userId: metadata?.userId,
            };

            // Add specific pending content
            if (state.pendingToolsCalling) {
              intervention.type = 'tool_approval';
              intervention.pendingToolsCalling = state.pendingToolsCalling;
            } else if (state.pendingHumanPrompt) {
              intervention.type = 'human_prompt';
              intervention.pendingHumanPrompt = state.pendingHumanPrompt;
            } else if (state.pendingHumanSelect) {
              intervention.type = 'human_select';
              intervention.pendingHumanSelect = state.pendingHumanSelect;
            }

            pendingInterventions.push(intervention);
          }
        } catch (error) {
          log('Failed to get state for operation %s: %O', operation, error);
        }
      }

      return {
        pendingInterventions,
        timestamp: new Date().toISOString(),
        totalCount: pendingInterventions.length,
      };
    } catch (error) {
      log('Failed to get pending interventions: %O', error);
      throw error;
    }
  }

  /**
   * Explicitly start operation execution
   */
  async startExecution(params: StartExecutionParams): Promise<StartExecutionResult> {
    const { operationId, context, priority = 'normal', delay = 50 } = params;

    try {
      log('Starting execution for operation %s', operationId);

      // Check if operation exists
      const operationMetadata = await this.coordinator.getOperationMetadata(operationId);
      if (!operationMetadata) {
        throw new Error(`Operation ${operationId} not found`);
      }

      // Get current state
      const currentState = await this.coordinator.loadAgentState(operationId);
      if (!currentState) {
        throw new Error(`Agent state not found for operation ${operationId}`);
      }

      // Check operation status
      if (currentState.status === 'running') {
        throw new Error(`Operation ${operationId} is already running`);
      }

      if (currentState.status === 'done') {
        throw new Error(`Operation ${operationId} is already completed`);
      }

      if (currentState.status === 'error') {
        throw new Error(`Operation ${operationId} is in error state`);
      }

      // Build execution context
      let executionContext = context;
      if (!executionContext) {
        // If no context provided, build default context from metadata
        // Note: AgentRuntimeContext requires sessionId for compatibility with @lobechat/agent-runtime
        executionContext = {
          payload: {
            isFirstMessage: true,
            message: [{ content: '' }],
          },
          phase: 'user_input' as const,
          session: {
            messageCount: currentState.messages?.length || 0,
            sessionId: operationId,
            status: 'idle' as const,
            stepCount: currentState.stepCount || 0,
          },
        };
      }

      // Update operation status to running
      await this.coordinator.saveAgentState(operationId, {
        ...currentState,
        lastModified: new Date().toISOString(),
        status: 'running',
      });

      // Schedule execution (if queue service is available)
      let messageId: string | undefined;
      if (this.queueService) {
        messageId = await this.queueService.scheduleMessage({
          context: executionContext,
          delay,
          endpoint: `${this.baseURL}/run`,
          operationId,
          priority,
          stepIndex: currentState.stepCount || 0,
        });
        log('Scheduled execution for operation %s (messageId: %s)', operationId, messageId);
      } else {
        log('Queue service disabled, skipping schedule for operation %s', operationId);
      }

      return {
        messageId,
        operationId,
        scheduled: !!messageId,
        success: true,
      };
    } catch (error) {
      log('Failed to start execution for operation %s: %O', operationId, error);
      throw error;
    }
  }

  /**
   * Process human intervention
   */
  async processHumanIntervention(params: {
    action: 'approve' | 'reject' | 'reject_continue' | 'input' | 'select';
    approvedToolCall?: any;
    humanInput?: any;
    operationId: string;
    rejectAndContinue?: boolean;
    rejectionReason?: string;
    stepIndex: number;
    toolMessageId?: string;
  }): Promise<{ messageId?: string }> {
    const {
      operationId,
      stepIndex,
      action,
      approvedToolCall,
      humanInput,
      rejectAndContinue,
      rejectionReason,
      toolMessageId,
    } = params;

    try {
      log(
        'Processing human intervention for operation %s:%d (action: %s)',
        operationId,
        stepIndex,
        action,
      );

      // Schedule execution with high priority (if queue service is available)
      let messageId: string | undefined;
      if (this.queueService) {
        messageId = await this.queueService.scheduleMessage({
          context: undefined, // Will be retrieved from state manager
          delay: 100,
          endpoint: `${this.baseURL}/run`,
          operationId,
          payload: {
            approvedToolCall,
            humanInput,
            rejectAndContinue,
            rejectionReason,
            toolMessageId,
          },
          priority: 'high',
          stepIndex,
        });
        log(
          'Scheduled immediate execution for operation %s (messageId: %s)',
          operationId,
          messageId,
        );
      } else {
        log('Queue service disabled, skipping schedule for operation %s', operationId);
      }

      return { messageId };
    } catch (error) {
      log('Failed to process human intervention for operation %s: %O', operationId, error);
      throw error;
    }
  }

  /**
   * Completion-bridge entry point for async sub-agent tools.
   *
   * Called once per sub-op completion (the bridge already backfilled that
   * sub-op's tool message). Implements the K=N barrier + single-fire resume:
   *
   *   1. The parent must still be parked (`waiting_for_async_tool`).
   *   2. Every tool in this turn's `pendingToolsCalling` must be fulfilled —
   *      the true gate, since the LLM can only continue once every tool_result
   *      message row is present (covers mixed sub-agent + client-tool batches).
   *   3. Atomically claim the resume via a status CAS; only the winner proceeds.
   *   4. Schedule the parent's next step (`resumeAsyncTool`), which re-enters
   *      the LLM with the refreshed tool results.
   *
   * Returns true only for the CAS winner that scheduled the resume.
   *
   * `options.scheduleVerifyOnHold` arms a one-shot delayed re-check
   * (`verifyAsyncToolBarrier`) when the parent is found not yet resumable.
   * Sub-agent completions set it to cover the child finishing before the
   * parent's parked state is persisted, and transient failures around the
   * last completion (a sibling dying between backfill and resume, a DB
   * hiccup during the barrier read). Pure concurrency needs no cover: each
   * completion checks the barrier only after committing its own backfill, so
   * the last committer always sees every earlier one. The re-check itself
   * never re-arms, so retries stay bounded.
   */
  async tryResumeParentFromAsyncTool(
    params: { parentOperationId: string },
    options?: {
      /**
       * Message id of a tool placeholder the caller just backfilled to a
       * terminal state. Trusted by the barrier as fulfilled without re-reading
       * `message_plugins` — closes the read-your-writes gap where the barrier
       * query hits a read replica that hasn't seen the just-committed write.
       */
      knownFulfilledMessageId?: string;
      /**
       * Group orchestration disposition (skipCallSupervisor / delegate → finish).
       * When omitted, resolved from the parked tool message's pluginState.
       */
      onComplete?: GroupActionOnComplete;
      scheduleVerifyOnHold?: boolean;
      /** 1-based watchdog attempt to arm when the parent isn't resumable yet. */
      verifyAttempt?: number;
    },
  ): Promise<boolean> {
    const { parentOperationId } = params;

    const state = await this.coordinator.loadAgentState(parentOperationId);
    if (!state) {
      // State expired (Redis TTL) or never persisted. A missing state at
      // completion time is a classic way a parent silently strands — but it is
      // often transient: a read replica that hasn't seen the park yet, or the
      // child outrunning the parent's park before its snapshot lands. Arm the
      // bounded verify so a later re-check can resume once the state is visible,
      // instead of giving up on the first miss. A genuinely-gone parent just
      // exhausts the attempt cap (verify_exhausted) rather than stranding here.
      log('[%s] async-tool resume: parent state missing/expired, arming verify', parentOperationId);
      asyncToolResumeCounter.add(1, { outcome: 'no_state' });
      await this.maybeScheduleAsyncToolVerify(parentOperationId, null, options);
      return false;
    }

    if (state.status !== 'waiting_for_async_tool') {
      // Not parked (yet). Either the op already resumed/finished — nothing to
      // do — or the child outran the parent's parking step; the delayed verify
      // re-checks once the park has had time to land.
      await this.maybeScheduleAsyncToolVerify(parentOperationId, state, options);
      return false;
    }

    const pending = (state.pendingToolsCalling ?? []) as ChatToolPayload[];
    if (pending.length === 0) {
      // Parked but no pending tools recorded — usually the parked snapshot's
      // `pendingToolsCalling` hasn't finished persisting yet. Warn, report, and
      // arm a fallback re-check rather than returning silently (the old bug).
      log(
        '[%s] async-tool resume: parked op has no pending tools, arming fallback',
        parentOperationId,
      );
      asyncToolResumeCounter.add(1, { outcome: 'no_pending' });
      await this.maybeScheduleAsyncToolVerify(parentOperationId, state, options);
      return false;
    }

    // Barrier: every pending tool must have a fulfilled tool_result message.
    const allFulfilled = await this.allPendingToolsFulfilled(
      pending,
      options?.knownFulfilledMessageId,
    );
    if (!allFulfilled) {
      log('[%s] async-tool barrier not yet satisfied, holding', parentOperationId);
      asyncToolResumeCounter.add(1, { outcome: 'barrier_held' });
      await this.maybeScheduleAsyncToolVerify(parentOperationId, state, options);
      return false;
    }

    // Group orchestration's skipCallSupervisor / delegate ends the supervisor
    // op without another LLM turn: the same CAS gate flips the parked op, but
    // the scheduled step finishes it (`finishAfterAsyncTool`) instead of
    // re-entering the LLM (`resumeAsyncTool`). Self-describing so the generic
    // verify watchdog resolves it correctly: the option (if any) wins, else the
    // hint persisted on the parked tool message's pluginState, else resume.
    const onComplete: GroupActionOnComplete =
      options?.onComplete ?? (await this.resolveAsyncToolOnComplete(pending));

    // Single-fire guard: only one concurrent completion flips the op.
    const won = await new AgentOperationModel(this.serverDB, this.userId).tryResumeFromAsyncTool(
      parentOperationId,
    );
    if (!won) {
      log('[%s] lost async-tool resume CAS, no-op', parentOperationId);
      asyncToolResumeCounter.add(1, { outcome: 'lost_cas' });
      return false;
    }

    asyncToolResumeCounter.add(1, { outcome: 'resumed' });

    log(
      '[%s] won async-tool resume CAS, scheduling step %d (onComplete: %s)',
      parentOperationId,
      state.stepCount,
      onComplete,
    );

    if (this.queueService) {
      await this.queueService.scheduleMessage({
        context: undefined,
        delay: 100,
        endpoint: `${this.baseURL}/run`,
        operationId: parentOperationId,
        payload:
          onComplete === 'finish' ? { finishAfterAsyncTool: true } : { resumeAsyncTool: true },
        priority: 'high',
        stepIndex: state.stepCount,
      });
    } else {
      log('[%s] queue service disabled, skipping async-tool resume schedule', parentOperationId);
    }

    return true;
  }

  /**
   * Arm the next bounded `verifyAsyncToolBarrier` re-check for a parent op whose
   * resume attempt found it not yet resumable. Skipped for terminal states
   * (nothing left to resume) and when the caller didn't opt in.
   *
   * Unlike the original single shot, the watchdog re-arms after each unsatisfied
   * check: the verify handler re-enters here with `verifyAttempt + 1`, backing
   * off exponentially up to {@link ASYNC_TOOL_VERIFY_MAX_ATTEMPTS}. A transient
   * miss (read-replica lag, a sibling dying between backfill and resume) is thus
   * retried instead of permanently stranding the parent. Once attempts are
   * exhausted the chain stops and the `verify_exhausted` metric fires so the
   * orphan is observable. For details see: async sub-agent suspend/resume stability hardening — bounded watchdog retry with exponential backoff.
   */
  private async maybeScheduleAsyncToolVerify(
    parentOperationId: string,
    state: AgentState | null,
    options?: { scheduleVerifyOnHold?: boolean; verifyAttempt?: number },
  ): Promise<void> {
    if (!options?.scheduleVerifyOnHold || !this.queueService) return;

    // `state` is null when the parked snapshot is missing/expired at completion
    // time (no_state). We can't read a status to skip a terminal op, but the
    // bounded attempt cap below keeps a genuinely-gone parent from re-arming
    // forever, so it's safe to retry instead of stranding on a transient miss.
    const status = state?.status as string | undefined;
    if (status === 'done' || status === 'error' || status === 'interrupted') return;

    const attempt = options.verifyAttempt ?? 1;
    if (attempt > ASYNC_TOOL_VERIFY_MAX_ATTEMPTS) {
      // Bounded retries spent and the parent is still not resumable — give up
      // re-arming and report so the stuck wait can be detected, not silently
      // accumulated.
      log(
        '[%s] async-tool barrier verify exhausted after %d attempts, giving up (status: %s)',
        parentOperationId,
        ASYNC_TOOL_VERIFY_MAX_ATTEMPTS,
        status ?? 'missing',
      );
      asyncToolResumeCounter.add(1, { outcome: 'verify_exhausted' });
      return;
    }

    const delay = asyncToolVerifyDelayMs(attempt);
    log(
      '[%s] scheduling async-tool barrier verify attempt %d/%d in %dms (status: %s)',
      parentOperationId,
      attempt,
      ASYNC_TOOL_VERIFY_MAX_ATTEMPTS,
      delay,
      status ?? 'missing',
    );

    try {
      await this.queueService.scheduleMessage({
        context: undefined,
        delay,
        endpoint: `${this.baseURL}/run`,
        operationId: parentOperationId,
        payload: { asyncToolVerifyAttempt: attempt, verifyAsyncToolBarrier: true },
        priority: 'high',
        stepIndex: state?.stepCount ?? 0,
      });
    } catch (error) {
      log(
        '[%s] failed to schedule async-tool barrier verify (non-fatal): %O',
        parentOperationId,
        error,
      );
    }
  }

  /**
   * Stream a `callSubAgent` child's running totals to the client, once per step.
   *
   * Addressed to the PARENT's operationId, not the child's: the client opens one
   * WebSocket per operation and never subscribes to the child's channel. The
   * parent's channel is still live because parking at `waiting_for_async_tool`
   * deliberately does not publish a stream-end event (see
   * `AgentRuntimeCoordinator.STREAM_END_STATUSES`).
   *
   * Rides `step_complete` rather than a new event type because `AgentStreamEventType`
   * is a closed union shared with the out-of-repo gateway worker; `phase` is the
   * established discriminator and unknown phases are ignored by older clients.
   *
   * The three stat fields are read from exactly the same state paths that
   * `completeSubAgentBridge` uses for its final backfill, so the live numbers
   * converge on the persisted ones instead of jumping when the run ends.
   *
   * Best-effort: a publish failure must not fail the sub-agent's step.
   */
  private async publishSubAgentProgress(state: AgentState, stepIndex: number): Promise<void> {
    const anchor = state?.metadata?.subAgentProgress as
      { parentOperationId: string; toolMessageId: string } | undefined;
    if (!anchor?.parentOperationId || !anchor.toolMessageId) return;

    try {
      await this.streamManager.publishStreamEvent(anchor.parentOperationId, {
        data: {
          model: state?.modelRuntimeConfig?.model,
          phase: 'subagent_progress',
          toolMessageId: anchor.toolMessageId,
          totalCost: state?.cost?.total,
          totalInputTokens: state?.usage?.llm?.tokens?.input,
          totalOutputTokens: state?.usage?.llm?.tokens?.output,
          totalTokens: state?.usage?.llm?.tokens?.total,
          totalToolCalls: state?.usage?.tools?.totalCalls,
        },
        stepIndex,
        type: 'step_complete',
      });
    } catch (error) {
      log('[%s] failed to publish sub-agent progress (non-fatal): %O', state?.operationId, error);
    }
  }

  /**
   * Sub-agent completion bridge for the server `callSubAgent` deferred-tool
   * path. Runs when a child sub-agent op reaches a terminal state — invoked
   * in-process by the child's `onComplete` hook handler (local mode) or via
   * the QStash-delivered `/webhooks/subagent-callback` endpoint (queue mode,
   * where in-memory handler hooks don't survive cross-process steps).
   *
   *   1. Backfill the parent's placeholder tool message with the sub-agent's
   *      final answer (success) or an error note (failure), plus pluginState
   *      so the UI render can resolve the isolation thread.
   *   2. Resume the parked parent: barrier-check + CAS via
   *      `tryResumeParentFromAsyncTool`, arming the delayed verify when the
   *      parent isn't resumable yet.
   *
   * THROWS on infrastructure failure of either half (state load, backfill,
   * resume) so the queue-mode callback returns non-2xx and QStash redelivers
   * the whole bridge — the delayed verify alone cannot recover a failed
   * backfill, it only re-reads the barrier. Redelivery is safe: the backfill
   * rewrites the same content and the resume is CAS-guarded.
   *
   * Returns true when this call won the resume CAS.
   */
  async completeSubAgentBridge(params: SubAgentBridgeParams): Promise<boolean> {
    const { operationId, parentOperationId, reason, threadId, toolMessageId } = params;
    const failed = reason === 'error' || reason === 'interrupted';

    // Infra errors propagate; a null state (expired) degrades to a stub note.
    const finalState =
      params.finalState ?? (await this.coordinator.loadAgentState(operationId)) ?? undefined;

    log(
      '[%s] sub-agent bridge → parent %s (reason: %s, state: %s)',
      operationId,
      parentOperationId,
      reason,
      finalState ? 'loaded' : 'missing',
    );

    // 1. Backfill the placeholder tool message with the result.
    // `updateToolMessage` swallows transaction errors into `success: false`,
    // so the flag must be checked — an unfulfilled message would hold the
    // parent's barrier forever while the callback acked with 200.
    //
    // A state loaded via the fallback above arrives without `messages` (the
    // persisted Redis blob no longer carries them — see
    // AgentStateManager.serializeStateForPersist). Resolve the final leaf from
    // the parsed DB conversation, then recover the original row by id so its
    // serialized content stays paired with metadata.isMultimodal. An in-process
    // params.finalState already carries messages and skips this query.
    let lastAssistant: unknown;
    if (!failed && finalState && !Array.isArray(finalState.messages)) {
      try {
        lastAssistant = await this.resolveLastAssistantMessageFromDB(finalState);
      } catch (error) {
        console.error(
          '[%s] sub-agent bridge: failed to resolve final assistant from DB: %O',
          operationId,
          error,
        );
      }
    }
    const messages = Array.isArray(finalState?.messages) ? finalState.messages : [];
    lastAssistant ??= findLastAssistantMessage(normalizeCompletionMessages(messages));
    let lastAssistantContent = extractTextFromMessage(lastAssistant);

    // Gated on `!finalState`, not merely an empty `lastAssistantContent`: a
    // real (authoritative) final state whose last turn is legitimately
    // textless (image-only, or the "preserve an empty leaf" case in
    // `normalizeCompletionMessages`) must keep the stub below, not go dig
    // through the thread's own message history — a lagging read could
    // surface an EARLIER real reply from the same thread and silently show
    // stale text instead of the correct empty-answer signal. `!finalState`
    // is exactly the case this fallback exists for: heterogeneous (CLI-driven)
    // children never populate it at all (see
    // `resolveLastAssistantContentFromThread`'s doc comment), so there is no
    // authoritative signal here to override.
    if (!failed && !finalState && threadId) {
      try {
        lastAssistantContent = await this.resolveLastAssistantContentFromThread(threadId);
      } catch (error) {
        console.error(
          '[%s] sub-agent bridge: failed to resolve content from thread %s: %O',
          operationId,
          threadId,
          error,
        );
      }
    }
    const errorReason = failed ? formatSubAgentErrorReason(finalState?.error) : undefined;
    const content = failed
      ? errorReason
        ? `Sub-agent did not complete (${reason}): ${errorReason}`
        : `Sub-agent did not complete (${reason}).`
      : lastAssistantContent || 'Sub-agent completed without a textual answer.';

    const backfill = await this.messageModel.updateToolMessage(toolMessageId, {
      content,
      pluginError: failed ? formatErrorForMetadata(finalState?.error) : undefined,
      pluginState: {
        model: finalState?.modelRuntimeConfig?.model,
        status: failed ? 'error' : 'completed',
        threadId,
        // The child's spend rides on this anchor row so the parent's usage tray can
        // account for it. The tray sums per-MESSAGE usage, and the child's own
        // assistant messages live in an isolation thread the parent never loads —
        // this row is the only place the child's cost surfaces in the parent's own
        // message list.
        totalCost: finalState?.cost?.total,
        totalInputTokens: finalState?.usage?.llm?.tokens?.input,
        totalOutputTokens: finalState?.usage?.llm?.tokens?.output,
        totalToolCalls: finalState?.usage?.tools?.totalCalls,
        totalTokens: finalState?.usage?.llm?.tokens?.total,
      },
    });
    if (!backfill.success) {
      throw new Error(
        `Sub-agent bridge: failed to backfill tool message ${toolMessageId} for parent ${parentOperationId}`,
      );
    }

    // 2. Barrier + CAS + resume the parent op (infra errors propagate too).
    // Pass the just-backfilled message id so the barrier trusts this write
    // instead of re-reading a possibly-stale replica.
    return this.tryResumeParentFromAsyncTool(
      { parentOperationId },
      { knownFulfilledMessageId: toolMessageId, scheduleVerifyOnHold: true },
    );
  }

  /**
   * Whether every pending tool call has a fulfilled tool_result message — i.e.
   * a tool message exists for its `tool_call_id` with non-empty content or a
   * terminal pluginState. Looks up by `tool_call_id` (plugin id === message id).
   *
   * `knownFulfilledMessageId` short-circuits the per-tool content/state read for
   * a placeholder the caller just backfilled in the same request: its terminal
   * write is a local fact, so re-reading it (possibly from a lagging read
   * replica) would only risk a false negative that strands the parent. The
   * plugin row itself predates the park, so the `tool_call_id → plugin.id`
   * lookup still resolves; only the freshly written content/state is trusted.
   */
  private async allPendingToolsFulfilled(
    pending: ChatToolPayload[],
    knownFulfilledMessageId?: string,
  ): Promise<boolean> {
    for (const tc of pending) {
      const plugin = await this.serverDB.query.messagePlugins.findFirst({
        where: (mp, { eq }) => eq(mp.toolCallId, tc.id),
      });
      if (!plugin) return false;

      // Trust the caller's own just-committed backfill (read-your-writes).
      if (knownFulfilledMessageId && plugin.id === knownFulfilledMessageId) continue;

      const message = await this.messageModel.findById(plugin.id);
      const pluginState = plugin.state as { status?: string } | null;
      const fulfilled =
        (!!message?.content && message.content.length > 0) ||
        pluginState?.status === 'completed' ||
        pluginState?.status === 'error';
      if (!fulfilled) return false;
    }
    return true;
  }

  /**
   * Resolve the resume disposition for a parked op from the disposition hint
   * persisted on its first pending tool message's pluginState. Group
   * orchestration stamps `onComplete: 'finish'` there for skipCallSupervisor /
   * delegate; everything else (sub-agents, client tools) resolves to `resume`.
   * Self-describing so the generic verify watchdog finishes the right ops.
   */
  private async resolveAsyncToolOnComplete(
    pending: ChatToolPayload[],
  ): Promise<GroupActionOnComplete> {
    // A batched turn can park multiple deferred/client tools. If ANY of them is
    // a group action requesting finish (skipCallSupervisor / delegate), the
    // orchestration must finish — reading only pending[0] would miss a group
    // finish call that isn't the first pending tool and wrongly resume.
    for (const tool of pending) {
      const plugin = await this.serverDB.query.messagePlugins.findFirst({
        where: (mp, { eq }) => eq(mp.toolCallId, tool.id),
      });
      const pluginState = plugin?.state as { onComplete?: string } | null;
      if (pluginState?.onComplete === 'finish') return 'finish';
    }
    return 'resume';
  }

  /**
   * Count fulfilled member anchors under a group-management tool call — child
   * `role: 'tool'` messages whose content is non-empty or whose pluginState is
   * terminal. The K=N member barrier for broadcast / executeAgentTasks: the
   * group tool message is only backfilled (satisfying the parked op's
   * single-tool barrier) once this reaches the expected member count.
   */
  private async countFulfilledMemberAnchors(groupToolMessageId: string): Promise<number> {
    const children = await this.serverDB.query.messages.findMany({
      where: (m, { and, eq }) => and(eq(m.parentId, groupToolMessageId), eq(m.role, 'tool')),
    });
    let fulfilled = 0;
    for (const child of children) {
      if (child.content && child.content.length > 0) {
        fulfilled += 1;
        continue;
      }
      const plugin = await this.serverDB.query.messagePlugins.findFirst({
        where: (mp, { eq }) => eq(mp.id, child.id),
      });
      const pluginState = plugin?.state as { status?: string } | null;
      if (pluginState?.status === 'completed' || pluginState?.status === 'error') fulfilled += 1;
    }
    return fulfilled;
  }

  /**
   * Completion bridge for the group orchestration "call agent member" path
   * (`lobe-group-management`: speak / broadcast / delegate / executeAgentTask(s)).
   * Mirrors {@link completeSubAgentBridge} but enforces a K=N member barrier:
   *
   *   1. Backfill this member's anchor tool message (in_group → a short receipt,
   *      since the member already spoke in the shared group conversation;
   *      isolated → the member's final answer from its hidden thread).
   *   2. Multi-member actions: hold until every member anchor is fulfilled, then
   *      backfill the supervisor's group tool message so the parked op's
   *      single-tool barrier passes. Single-member actions collapse the anchor
   *      onto the group tool call, so step 1 already satisfies the barrier.
   *   3. Barrier-check + CAS resume/finish the parked supervisor via
   *      `tryResumeParentFromAsyncTool` (finish disposition read from the group
   *      tool message's pluginState).
   *
   * THROWS on infra failure of any backfill so the queue-mode callback returns
   * non-2xx and QStash redelivers — backfills are idempotent and the resume is
   * CAS-guarded, so redelivery is safe.
   */
  async completeGroupActionMember(params: GroupActionMemberBridgeParams): Promise<boolean> {
    const {
      anchorMessageId,
      expectedMembers,
      groupToolMessageId,
      mode,
      operationId,
      parentOperationId,
      reason,
      threadId,
    } = params;
    const failed = reason === 'error' || reason === 'interrupted' || reason === 'timeout';

    const finalState =
      params.finalState ?? (await this.coordinator.loadAgentState(operationId)) ?? undefined;

    log(
      '[%s] group-member bridge → parent %s (mode: %s, reason: %s, %d members)',
      operationId,
      parentOperationId,
      mode,
      reason,
      expectedMembers,
    );

    // 1. Backfill this member's anchor.
    // The member's textual answer is only read in delegate mode below; a state
    // loaded via the fallback above arrives without `messages` (dropped from
    // the persisted Redis blob — see AgentStateManager.serializeStateForPersist),
    // so resolve the original final leaf from the DB when we actually need it.
    // Keeping the original row preserves the exact content/metadata pairing
    // that conversation-flow display grouping intentionally aggregates.
    let lastAssistant: unknown;
    if (!failed && mode !== 'in_group' && finalState && !Array.isArray(finalState.messages)) {
      try {
        lastAssistant = await this.resolveLastAssistantMessageFromDB(finalState);
      } catch (error) {
        console.error(
          '[%s] group-member bridge: failed to resolve final assistant from DB: %O',
          operationId,
          error,
        );
      }
    }
    const messages = Array.isArray(finalState?.messages) ? finalState.messages : [];
    lastAssistant ??= findLastAssistantMessage(normalizeCompletionMessages(messages));
    let lastAssistantContent = extractTextFromMessage(lastAssistant);

    // Gated on `!finalState`, not merely an empty `lastAssistantContent` —
    // see the identical guard (and its full rationale) in
    // `completeSubAgentBridge`. A real final state whose last turn is
    // legitimately textless must keep the stub below, not risk surfacing a
    // stale earlier reply from the thread's own history. `!finalState` is
    // exactly the heterogeneous-isolated-member case this fallback exists
    // for: it never populates `finalState` at all.
    if (!failed && mode !== 'in_group' && !finalState && threadId) {
      try {
        lastAssistantContent = await this.resolveLastAssistantContentFromThread(threadId);
      } catch (error) {
        console.error(
          '[%s] group-member bridge: failed to resolve content from thread %s: %O',
          operationId,
          threadId,
          error,
        );
      }
    }
    const agentLabel = (finalState?.metadata?.agentId as string | undefined) ?? 'member';
    const memberErrorReason = failed ? formatSubAgentErrorReason(finalState?.error) : undefined;
    const anchorContent = failed
      ? memberErrorReason
        ? `Agent member did not complete (${reason}): ${memberErrorReason}`
        : `Agent member did not complete (${reason}).`
      : mode === 'in_group'
        ? `Agent ${agentLabel} responded in the group.`
        : lastAssistantContent || 'Agent member completed without a textual answer.';

    const anchorBackfill = await this.messageModel.updateToolMessage(anchorMessageId, {
      content: anchorContent,
      pluginError: failed ? formatErrorForMetadata(finalState?.error) : undefined,
      pluginState: {
        model: finalState?.modelRuntimeConfig?.model,
        status: failed ? 'error' : 'completed',
        threadId,
        // The child's spend rides on this anchor row so the parent's usage tray can
        // account for it. The tray sums per-MESSAGE usage, and the child's own
        // assistant messages live in an isolation thread the parent never loads —
        // this row is the only place the child's cost surfaces in the parent's own
        // message list.
        totalCost: finalState?.cost?.total,
        totalInputTokens: finalState?.usage?.llm?.tokens?.input,
        totalOutputTokens: finalState?.usage?.llm?.tokens?.output,
        totalToolCalls: finalState?.usage?.tools?.totalCalls,
        totalTokens: finalState?.usage?.llm?.tokens?.total,
      },
    });
    if (!anchorBackfill.success) {
      throw new Error(
        `Group-member bridge: failed to backfill anchor ${anchorMessageId} for parent ${parentOperationId}`,
      );
    }

    // 2. K=N member barrier (multi-member actions only — single-member actions
    //    use the group tool call itself as the anchor, already backfilled above).
    if (expectedMembers > 1 && anchorMessageId !== groupToolMessageId) {
      const fulfilled = await this.countFulfilledMemberAnchors(groupToolMessageId);
      if (fulfilled < expectedMembers) {
        log(
          '[%s] group-member barrier %d/%d, holding parent %s',
          operationId,
          fulfilled,
          expectedMembers,
          parentOperationId,
        );
        const parentState = await this.coordinator.loadAgentState(parentOperationId);
        if (parentState) {
          await this.maybeScheduleAsyncToolVerify(parentOperationId, parentState, {
            scheduleVerifyOnHold: true,
          });
        }
        return false;
      }

      // All members done — backfill the group tool call so the parked op's
      // single-tool barrier ([groupTool]) passes. Idempotent across racing
      // last-committers; the resume/finish CAS guarantees one transition.
      const groupBackfill = await this.messageModel.updateToolMessage(groupToolMessageId, {
        content: `All ${expectedMembers} agent members completed.`,
        pluginState: { expectedMembers, status: 'completed' },
      });
      if (!groupBackfill.success) {
        throw new Error(
          `Group-member bridge: failed to backfill group tool ${groupToolMessageId} for parent ${parentOperationId}`,
        );
      }
    }

    // 3. Barrier + CAS + resume/finish the parked supervisor op.
    return this.tryResumeParentFromAsyncTool({ parentOperationId }, { scheduleVerifyOnHold: true });
  }

  /**
   * Schedule the group-member timeout watchdog. Fired `delayMs` after the member
   * op is forked; if the member hasn't finished by then, the watchdog interrupts
   * it and bridges a `timeout` completion so the parked supervisor doesn't wait
   * forever. No-op when the queue is disabled or the timeout is non-positive.
   */
  async scheduleGroupMemberTimeout(
    params: GroupMemberTimeoutParams,
    delayMs: number,
  ): Promise<void> {
    if (!this.queueService || !(delayMs > 0)) return;
    try {
      await this.queueService.scheduleMessage({
        context: undefined,
        delay: delayMs,
        endpoint: `${this.baseURL}/run`,
        // Keyed on the member op so the /run worker can resolve userId from its
        // metadata, same trust chain as every other scheduled step.
        operationId: params.memberOperationId,
        payload: { groupMemberTimeout: params },
        priority: 'normal',
        stepIndex: 0,
      });
      log(
        '[%s] scheduled group-member timeout in %dms (parent %s)',
        params.memberOperationId,
        delayMs,
        params.parentOperationId,
      );
    } catch (error) {
      log(
        '[%s] failed to schedule group-member timeout (non-fatal): %O',
        params.memberOperationId,
        error,
      );
    }
  }

  /**
   * Enforce a group member's timeout. No-op if the member already reached a
   * terminal state (its own completion bridge handles that). Otherwise interrupt
   * the member and bridge a `timeout` completion — backfilling its anchor and
   * resuming/finishing the parked supervisor via the K=N barrier. The member's
   * own interrupt bridge may also fire; both are idempotent (anchor rewrite +
   * CAS-guarded resume).
   */
  private async handleGroupMemberTimeout(
    params: GroupMemberTimeoutParams,
  ): Promise<AgentExecutionResult> {
    const state = await this.coordinator.loadAgentState(params.memberOperationId);
    const status = state?.status as string | undefined;
    if (!state || status === 'done' || status === 'error' || status === 'interrupted') {
      log(
        '[%s] group-member timeout: member already terminal (%s), no-op',
        params.memberOperationId,
        status,
      );
      return { nextStepScheduled: false, state: {}, success: true };
    }

    log(
      '[%s] group-member timeout fired, interrupting + bridging timeout to parent %s',
      params.memberOperationId,
      params.parentOperationId,
    );
    await this.interruptOperation(params.memberOperationId);

    const resumed = await this.completeGroupActionMember({
      anchorMessageId: params.anchorMessageId,
      expectedMembers: params.expectedMembers,
      finalState: state,
      groupToolMessageId: params.groupToolMessageId,
      mode: params.mode,
      onComplete: params.onComplete,
      operationId: params.memberOperationId,
      parentOperationId: params.parentOperationId,
      reason: 'timeout',
    });

    return { nextStepScheduled: resumed, state: {}, success: true };
  }

  private async queryMessagesFromDB(state: AgentState) {
    let postProcessUrl: ((path: string | null) => Promise<string>) | undefined;
    try {
      const fileService = new FileService(this.serverDB, this.userId);
      postProcessUrl = (path: string | null) => fileService.getFullFileUrl(path);
    } catch {
      postProcessUrl = undefined;
    }

    return this.messageModel.query(
      {
        agentId: state.metadata?.agentId,
        // Group runs must pass groupId, else the query filters `groupId IS NULL`
        // and returns no group messages — the next LLM step then gets an empty
        // context and the provider rejects it ("at least one message is required").
        groupId: state.metadata?.groupId,
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      },
      // The run's own topic is already resolved and authorized; an agent-share
      // visitor run executes under the CREATOR's identity, so it must opt out
      // of `query()`'s creator-facing agent-share exclusion.
      { allowShareVisitor: true, postProcessUrl },
    );
  }

  /**
   * Reload the conversation messages from the database and flatten them for the
   * runtime. Used when resuming a parked op so the next LLM step sees tool
   * results written out-of-band (e.g. by a sub-agent completion bridge).
   */
  private async refreshMessagesFromDB(state: AgentState): Promise<AgentState['messages']> {
    const dbMessages = await this.queryMessagesFromDB(state);

    const { flatList } = parse(dbMessages);
    return flatList as AgentState['messages'];
  }

  /**
   * Use conversation-flow to select the active final assistant leaf, then
   * recover that leaf from the original query result. FlatListBuilder moves
   * child metadata onto its display-only group/first child, so the parsed leaf
   * alone cannot reliably identify serialized multimodal content.
   */
  private async resolveLastAssistantMessageFromDB(state: AgentState): Promise<unknown> {
    const dbMessages = await this.queryMessagesFromDB(state);
    const { flatList } = parse(dbMessages);
    const lastAssistant = findLastAssistantMessage(normalizeCompletionMessages(flatList));
    const lastAssistantId = typeof lastAssistant?.id === 'string' ? lastAssistant.id : undefined;

    return (
      (lastAssistantId
        ? dbMessages.find((message) => message.id === lastAssistantId)
        : undefined) ?? lastAssistant
    );
  }

  /**
   * Fallback content resolution for a heterogeneous (CLI-driven) sub-agent
   * child in queue mode. `coordinator.loadAgentState`/`finalState` is always
   * empty here: a hetero run never writes into the Redis-backed runtime state
   * this class's step loop maintains (only `saveAgentState` calls under the
   * homogeneous step loop populate it), and the completion webhook's
   * `eventFields` deliberately excludes `lastAssistantContent` to keep the
   * QStash payload lean (see `createSubAgentBridgeHook`'s doc comment) —
   * `heteroFinish` already resolves the real answer server-side before
   * dispatching, but that resolution never reaches this callback.
   *
   * The child's own conversation is queryable directly by its isolation
   * `threadId` regardless — the same source `heteroFinish` itself reads via
   * `heteroCurrentMsgId` before completion. Scoping by `threadId` alone is
   * sufficient: thread ids are unique, so no `agentId`/`topicId` is needed to
   * disambiguate.
   */
  private async resolveLastAssistantContentFromThread(
    threadId: string,
  ): Promise<string | undefined> {
    const messages = await this.messageModel.query({ threadId }, { allowShareVisitor: true });
    const lastAssistant = findLastAssistantMessage(normalizeCompletionMessages(messages));
    return extractTextFromMessage(lastAssistant) || undefined;
  }

  /**
   * Overwrite `state.messages` in place with the canonical DB conversation at
   * step entry, making the DB the single source of truth for messages.
   *
   * Guarded against regressions:
   * - Ops carrying a non-persisted (ephemeral / suppressed) message — e.g. the
   *   group-member supervisor instruction, which has no DB row — keep their
   *   full working set in Redis (see `AgentStateManager.serializeStateForPersist`),
   *   so leave the loaded array intact instead of clobbering it with a DB-only
   *   view that would drop the prompt.
   * - `state.messages` is guaranteed to end up an array, so a missing-identifier
   *   early return or an empty/failed read never hands `undefined` to downstream
   *   consumers (e.g. `shouldCompress(state.messages)`).
   * - A populated working set is never replaced with an empty one or on a DB
   *   error, so a transient read miss can't blank the conversation mid-op.
   */
  private async rehydrateStateMessagesFromDB(state: AgentState): Promise<void> {
    if (hasNonPersistedMessage(state.messages)) return;

    if (!Array.isArray(state.messages)) state.messages = [];

    if (!state.metadata?.agentId || !state.metadata?.topicId) return;

    try {
      const refreshed = await this.refreshMessagesFromDB(state);
      if (refreshed.length > 0) state.messages = refreshed;
    } catch (error) {
      console.error(
        '[rehydrateStateMessagesFromDB] failed, keeping Redis state snapshot: %O',
        error,
      );
    }
  }

  private resolveAsyncToolResumeParentMessageId(
    messages: AgentState['messages'],
    pendingTools: ChatToolPayload[],
  ): string | undefined {
    const fallbackParentMessageId = messages.at(-1)?.id;
    if (pendingTools.length === 0) return fallbackParentMessageId;

    const toolResultMessageIds = new Map<string, string>();

    const collectToolResultIds = (message: unknown) => {
      if (!message || typeof message !== 'object') return;

      const candidate = message as {
        children?: unknown;
        id?: unknown;
        tool_call_id?: unknown;
        tools?: unknown;
      };

      if (typeof candidate.tool_call_id === 'string' && typeof candidate.id === 'string') {
        toolResultMessageIds.set(candidate.tool_call_id, candidate.id);
      }

      if (Array.isArray(candidate.tools)) {
        for (const tool of candidate.tools) {
          if (!tool || typeof tool !== 'object') continue;

          const toolPayload = tool as { id?: unknown; result_msg_id?: unknown };
          if (typeof toolPayload.id === 'string' && typeof toolPayload.result_msg_id === 'string') {
            toolResultMessageIds.set(toolPayload.id, toolPayload.result_msg_id);
          }
        }
      }

      if (Array.isArray(candidate.children)) {
        for (const child of candidate.children) {
          collectToolResultIds(child);
        }
      }
    };

    for (const message of messages) {
      collectToolResultIds(message);
    }

    for (let index = pendingTools.length - 1; index >= 0; index -= 1) {
      const pendingTool = pendingTools[index];
      if (pendingTool.result_msg_id) return pendingTool.result_msg_id;

      const resultMessageId = toolResultMessageIds.get(pendingTool.id);
      if (resultMessageId) return resultMessageId;
    }

    return fallbackParentMessageId;
  }

  /**
   * Create Agent Runtime instance
   */
  private async createAgentRuntime({
    abortSignal,
    agentState,
    metadata,
    operationId,
    stepIndex,
    tracingContextEngine,
  }: {
    /** Cancels in-flight tool work when this step's operation is interrupted. */
    abortSignal?: AbortSignal;
    /**
     * Current runtime state, when the caller has it. Only consulted to decide
     * whether the early final-answer `visible_output_end` must be suppressed
     * (entity-file edits ⇒ completion still has to export + register file
     * Works, so loading should cover that window).
     */
    agentState?: any;
    metadata?: any;
    operationId: string;
    stepIndex: number;
    tracingContextEngine?: (input: unknown, output: unknown) => void;
  }) {
    const contextWindowTokens =
      metadata?.modelRuntimeConfig?.model && metadata?.modelRuntimeConfig?.provider
        ? await getModelPropertyWithFallback<number | undefined>(
            metadata.modelRuntimeConfig.model,
            'contextWindowTokens',
            metadata.modelRuntimeConfig.provider,
          )
        : undefined;

    // Create Agent instance — use custom factory if provided, otherwise default to GeneralChatAgent
    const generalConfig = {
      agentConfig: metadata?.agentConfig,
      compressionConfig: {
        enabled: metadata?.agentConfig?.chatConfig?.enableContextCompression ?? true,
        maxWindowToken: contextWindowTokens ?? undefined,
      },
      dynamicInterventionAudits,
      modelRuntimeConfig: metadata?.modelRuntimeConfig,
      operationId,
      userId: metadata?.userId,
    };

    if (
      metadata?.trigger === RequestTrigger.Eval &&
      metadata.evalRuntime?.toolForwarding &&
      !hookDispatcher.hasHook(operationId, EVAL_TOOL_FORWARDING_HOOK_ID)
    ) {
      hookDispatcher.register(operationId, [
        createEvalToolForwardingHook(
          metadata.evalRuntime.toolForwarding,
          metadata.evalRuntime.caseId,
        ),
      ]);
    }

    const agent = this.agentFactory
      ? this.agentFactory(generalConfig)
      : new GeneralChatAgent(generalConfig);

    // Create streaming executor context
    const executorContext: RuntimeExecutorContext = {
      abortSignal,
      agentConfig: metadata?.agentConfig,
      // The factory may be a Graph-aware dispatcher that still returns the
      // default agent for ordinary conversations. Keep the early visible
      // output end behavior tied to the actual agent, not factory presence.
      //
      // Additionally suppressed once the run edited entity-format files:
      // completion still exports + registers them as `file` Works BEFORE the
      // terminal snapshot (see `CompletionLifecycle.registerFileWorks`), and
      // an early hint would end the visible loading seconds before that card
      // can exist. Deferring to the terminal `visible_output_end` lets loading
      // cover the export and the card land with `agent_runtime_end`.
      agentShareVisitor: metadata?.agentShareVisitor,
      allowEarlyFinalAnswerVisibleOutputEnd:
        agent instanceof GeneralChatAgent && !stateHasEntityFileEdits(agentState),
      botContext: metadata?.botContext,
      botPlatformContext: metadata?.botPlatformContext,
      discordContext: metadata?.discordContext,
      userTimezone: metadata?.userTimezone,
      evalContext: metadata?.evalContext,
      execSubAgent: this.delegate.execSubAgent,
      execVirtualSubAgent: this.delegate.execVirtualSubAgent,
      execGroupMember: this.delegate.execGroupMember,
      hookDispatcher,
      loadAgentState: this.coordinator.loadAgentState.bind(this.coordinator),
      messageModel: this.messageModel,
      operationId,
      searchDecision: metadata?.searchDecision,
      serverDB: this.serverDB,
      stepIndex,
      stream: metadata?.stream,
      streamManager: this.streamManager,
      toolExecutionService: this.toolExecutionService,
      topicId: metadata?.topicId,
      tracingContextEngine,
      userId: metadata?.userId,
      workspaceId: this.workspaceId,
    };

    // Create Agent Runtime instance
    const runtime = new AgentRuntime(agent as any, {
      executors: createRuntimeExecutors(executorContext),
    });

    return { agent, runtime };
  }

  /**
   * Compute device context from DB messages at step boundary.
   * Uses findInMessages visitor to scan tool messages for device activation.
   */
  private async computeDeviceContext(state: any) {
    try {
      const dbMessages = await this.messageModel.query(
        {
          agentId: state.metadata?.agentId,
          // Group runs need groupId or the query returns no group messages
          // (standard branch filters `groupId IS NULL`), losing the device context.
          groupId: state.metadata?.groupId,
          threadId: state.metadata?.threadId,
          topicId: state.metadata?.topicId,
        },
        { allowShareVisitor: true },
      );

      return findInMessages(
        dbMessages,
        (msg) => {
          const activeDeviceId = msg.pluginState?.metadata?.activeDeviceId;
          if (activeDeviceId) {
            return {
              activeDeviceId,
              devicePlatform: msg.pluginState?.metadata?.devicePlatform as string | undefined,
              deviceSystemInfo: msg.pluginState?.metadata?.deviceSystemInfo as
                Record<string, string> | undefined,
            };
          }
        },
        { role: 'tool' },
      );
    } catch (error) {
      log('computeDeviceContext error: %O', error);
    }

    return undefined;
  }

  /**
   * Decide whether to continue execution
   */
  private shouldContinueExecution(state: any, context?: any): boolean {
    // Completed
    if (state.status === 'done') return false;

    // Needs human intervention
    if (state.status === 'waiting_for_human') return false;

    // Parked waiting for an async tool result (client tool / sub-agent)
    if (state.status === 'waiting_for_async_tool') return false;

    // Error occurred
    if (state.status === 'error') return false;

    // Interrupted
    if (state.status === 'interrupted') return false;

    // maxSteps is handled by runtime.step() which sets forceFinish → status:'done'
    // No redundant check here — trust the runtime state machine

    // Exceeded cost limit
    if (state.costLimit && state.cost?.total >= state.costLimit.maxTotalCost) {
      return state.costLimit.onExceeded !== 'stop';
    }

    // No next context
    if (!context) return false;

    return true;
  }

  /**
   * Identify a provider redelivery that must replay a completed approval
   * lifecycle instead of being acknowledged as an ordinary stale step.
   *
   * `pendingApprovalBatch` is the durable, sealed runtime marker written before
   * Review publication. The QStash retry header distinguishes a failed request
   * redelivery from a benign duplicate that arrived after a successful ACK.
   */
  private shouldReplayPendingInterventionLifecycle(
    state: AgentState,
    stepIndex: number,
    externalRetryCount: number,
  ): boolean {
    const checkpoint = state.metadata?.[INTERVENTION_LIFECYCLE_CHECKPOINT_KEY] as
      InterventionLifecycleCheckpoint | undefined;

    return (
      externalRetryCount > 0 &&
      state.status === 'waiting_for_human' &&
      state.pendingApprovalBatch?.sealed === true &&
      // A missing checkpoint is a rollout-compatible pending state. Once a
      // successful lifecycle writes `completed`, a lost HTTP response can be
      // ACKed without publishing the Review or onComplete hook a second time.
      (!checkpoint || (checkpoint.stepIndex === stepIndex && checkpoint.state === 'pending'))
    );
  }

  /**
   * Checkpoint a fully delivered Review + onComplete lifecycle before the step
   * request returns. This closes the common response-loss window: QStash may
   * redeliver, but the stale-step guard can ACK a completed checkpoint without
   * duplicating either side effect. The Review itself remains batch-idempotent
   * for the smaller crash window before this checkpoint is saved.
   */
  private async recordInterventionLifecycleCompletion(
    operationId: string,
    state: AgentState,
    stepIndex: number,
  ): Promise<void> {
    state.metadata = {
      ...state.metadata,
      [INTERVENTION_LIFECYCLE_CHECKPOINT_KEY]: {
        state: 'completed',
        stepIndex,
      } satisfies InterventionLifecycleCheckpoint,
    };

    try {
      await this.coordinator.saveAgentState(operationId, state);
    } catch (error) {
      // The Review and hook are already delivered. Do not turn a best-effort
      // dedup checkpoint failure into an agent error; a rare later redelivery
      // safely retries the batch-idempotent Review and at-least-once hook.
      log(
        '[%s][%d] Failed to save intervention lifecycle checkpoint: %O',
        operationId,
        stepIndex,
        error,
      );
    }
  }

  /**
   * Calculate step delay
   */
  private calculateStepDelay(stepResult: any): number {
    const baseDelay = 50;

    // If there are tool calls, add longer delay
    if (stepResult.events?.some((e: any) => e.type === 'tool_result')) {
      return baseDelay + 50;
    }

    // If there are errors, use exponential backoff
    if (stepResult.events?.some((e: any) => e.type === 'error')) {
      return Math.min(baseDelay * 2, 1000);
    }

    return baseDelay;
  }

  /**
   * Calculate priority
   */
  private calculatePriority(stepResult: any): 'high' | 'normal' | 'low' {
    // If human intervention needed, high priority
    if (stepResult.newState?.status === 'waiting_for_human') {
      return 'high';
    }

    // If there are errors, normal priority
    if (stepResult.events?.some((e: any) => e.type === 'error')) {
      return 'normal';
    }

    return 'normal';
  }

  /**
   * Determine operation completion reason
   */
  private determineCompletionReason(state: AgentState): StepCompletionReason {
    if (state.status === 'done') return 'done';
    if (state.status === 'error') return 'error';
    if (state.status === 'interrupted') return 'interrupted';
    if (state.status === 'waiting_for_human') return 'waiting_for_human';
    if (state.status === 'waiting_for_async_tool') return 'waiting_for_async_tool';
    if (state.maxSteps && state.stepCount >= state.maxSteps) return 'max_steps';
    if (state.costLimit && state.cost?.total >= state.costLimit.maxTotalCost) return 'cost_limit';
    return 'done';
  }

  /**
   * Synchronously execute Agent operation until completion
   *
   * Used in test scenarios, doesn't depend on QueueService, executes all steps directly in the current process.
   *
   * @param operationId Operation ID
   * @param options Execution options
   * @returns Final state
   *
   * @example
   * ```ts
   * // Create operation (without auto-starting queue)
   * const result = await service.createOperation({ ...params, autoStart: false });
   *
   * // Synchronously execute to completion
   * const finalState = await service.executeSync(result.operationId);
   * expect(finalState.status).toBe('done');
   * ```
   */
  async executeSync(
    operationId: string,
    options?: {
      /** Initial context (if not provided, inferred from state) */
      initialContext?: AgentRuntimeContext;
      /** Maximum step limit to prevent infinite loops, defaults to 9999 */
      maxSteps?: number;
      /** Callback after each step execution (for debugging) */
      onStepComplete?: (stepIndex: number, state: AgentState) => void;
    },
  ): Promise<AgentState> {
    const { maxSteps = 999, onStepComplete, initialContext } = options ?? {};

    log('[%s] Starting sync execution (maxSteps: %d)', operationId, maxSteps);

    // Load initial state
    const initialState = await this.coordinator.loadAgentState(operationId);
    if (!initialState) {
      throw new Error(`Agent state not found for operation ${operationId}`);
    }

    let state: AgentState = initialState;

    // Build initial context
    // Priority: explicit initialContext param > saved initialContext in state > default
    let context: AgentRuntimeContext | undefined =
      initialContext ??
      (state as any).initialContext ??
      ({
        payload: {},
        phase: 'user_input' as const,
        session: {
          messageCount: state.messages?.length ?? 0,
          sessionId: operationId,
          status: state.status,
          stepCount: state.stepCount,
        },
      } as AgentRuntimeContext);

    let stepIndex = state.stepCount;

    // Execution loop
    while (stepIndex < maxSteps) {
      // Check termination conditions
      if (state.status === 'done' || state.status === 'error' || state.status === 'interrupted') {
        log('[%s] Sync execution finished with status: %s', operationId, state.status);
        break;
      }

      // Parked on a pause (human intervention or an async tool / sub-agent
      // result) — the result is delivered out-of-band, so sync execution
      // can't resume it
      if (isParkedStatus(state.status)) {
        log('[%s] Sync execution paused: %s', operationId, state.status);
        break;
      }

      // Execute one step
      log('[%s][%d] Start executing...', operationId, stepIndex);
      const result = await this.executeStep({
        context,
        operationId,
        stepIndex,
      });

      state = result.state as AgentState;
      context = result.stepResult.nextContext;
      stepIndex++;

      // Callback
      if (onStepComplete) {
        onStepComplete(stepIndex, state);
      }

      // Check if should continue
      if (!this.shouldContinueExecution(state, context)) {
        log('[%s] Sync execution stopped: shouldContinue=false', operationId);
        break;
      }
    }

    if (stepIndex >= maxSteps) {
      log('[%s] Sync execution stopped: reached maxSteps (%d)', operationId, maxSteps);
      // If stopped due to executeSync's maxSteps limit, need to manually dispatch onComplete hooks
      // Note: If stopped due to state.maxSteps being reached, onComplete has already been called in executeStep
      if (state.status !== 'done' && state.status !== 'error') {
        await this.completionLifecycle.emitSignalEvents(operationId, state, 'max_steps');
        await this.completionLifecycle.dispatchHooks(operationId, state, 'max_steps');
      }
    }

    return state;
  }

  /**
   * Get Coordinator instance (for testing)
   */
  getCoordinator(): AgentRuntimeCoordinator {
    return this.coordinator;
  }
}
