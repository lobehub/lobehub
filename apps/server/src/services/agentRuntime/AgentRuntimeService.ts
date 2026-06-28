import type {
  Agent,
  AgentRuntimeContext,
  AgentState,
  GeneralAgentConfig,
} from '@lobechat/agent-runtime';
import {
  AgentRuntime,
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
import {
  type ChatToolPayload,
  type ExecSubAgentParams,
  type ExecVirtualSubAgentParams,
  type UIChatMessage,
} from '@lobechat/types';
import debug from 'debug';
import urlJoin from 'url-join';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { type AgentRuntimeCoordinatorOptions } from '@/server/modules/AgentRuntime';
import { AgentRuntimeCoordinator, createStreamEventManager } from '@/server/modules/AgentRuntime';
import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';
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

import { isAbortError, throwIfAborted } from './abort';
import { CompletionLifecycle } from './CompletionLifecycle';
import { hookDispatcher } from './hooks';
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
  // eslint-disable-next-line no-console
  debug.log = console.log.bind(console);
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

/**
 * Exponential backoff delay for the Nth (1-based) watchdog re-check:
 * 15s, 30s, 60s, 120s, 240s, capped at {@link ASYNC_TOOL_VERIFY_MAX_DELAY_MS}.
 */
const asyncToolVerifyDelayMs = (attempt: number): number =>
  Math.min(
    ASYNC_TOOL_VERIFY_DELAY_MS * 2 ** (Math.max(1, attempt) - 1),
    ASYNC_TOOL_VERIFY_MAX_DELAY_MS,
  );

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
  execSubAgent?: (params: ExecSubAgentParams) => Promise<unknown>;
  /**
   * Fork a `lobe-agent.callSubAgent` virtual child run. The child is marked as a
   * sub-agent and owns the completion bridge that backfills the parent tool
   * placeholder before resuming the parked parent operation.
   */
  execVirtualSubAgent?: (params: ExecVirtualSubAgentParams) => Promise<unknown>;
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
    this.messageModel = new MessageModel(db, this.userId, workspaceId);
    this.completionLifecycle = new CompletionLifecycle(db, userId, workspaceId);
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

  // ==================== Operation Management ====================

  /**
   * Create a new Agent operation
   */
  async createOperation(params: OperationCreationParams): Promise<OperationCreationResult> {
    const {
      activeDeviceId,
      operationId,
      initialContext,
      agentConfig,
      agentGroup,
      modelRuntimeConfig,
      userId,
      autoStart = true,
      stream,
      initialMessages = [],
      appContext,
      toolSet,
      hooks,
      userInterventionConfig,
      queueRetries,
      queueRetryDelay,
      botContext,
      botPlatformContext,
      deviceAccessPolicy,
      discordContext,
      evalContext,
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
    await this.completionLifecycle.recordStart({
      agentId: appContext?.agentId ?? null,
      appContext: {
        defaultTaskAssigneeAgentId: appContext?.defaultTaskAssigneeAgentId,
        documentId: appContext?.documentId,
        groupId: appContext?.groupId,
        scope: appContext?.scope,
        sourceMessageId: appContext?.sourceMessageId,
      },
      chatGroupId: appContext?.groupId ?? null,
      maxSteps,
      // Persist the Agent Signal run marker on the operation row so server-side
      // self-iteration tools can read it back (metadata.agentSignal) at tool-call
      // time — the trimmed appContext above intentionally drops it.
      ...(appContext?.agentSignal ? { metadata: { agentSignal: appContext.agentSignal } } : {}),
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
      const initialState = {
        createdAt: new Date().toISOString(),
        // Store initialContext for executeSync to use
        initialContext,
        lastModified: new Date().toISOString(),
        // Use the passed initial messages
        messages: initialMessages,
        metadata: {
          activeDeviceId,
          agentConfig,
          agentGroup,
          botContext,
          botPlatformContext,
          deviceAccessPolicy,
          deviceSystemInfo,
          discordContext,
          evalContext,
          executionPlan,
          // need be removed
          modelRuntimeConfig,
          queueRetries,
          queueRetryDelay,
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
      // not one per member (single-connection multiplexing, LOBE-10868).
      const mirrorToOperationId =
        appContext?.orchestrationRole === 'member' ? (parentOperationId ?? undefined) : undefined;
      await this.coordinator.createAgentOperation(operationId, {
        agentConfig,
        mirrorToOperationId,
        modelRuntimeConfig,
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

      throwIfAborted(signal, 'Agent execution aborted before first step scheduling');

      let messageId: string | undefined;
      let autoStarted = false;

      if (autoStart && this.queueService) {
        // Both local and queue modes use scheduleMessage
        // LocalQueueServiceImpl uses setTimeout + callback mechanism
        // QStashQueueServiceImpl schedules HTTP requests
        messageId = await this.queueService.scheduleMessage({
          context: initialContext,
          delay: 50, // Short delay for startup
          endpoint: `${this.baseURL}/run`,
          operationId,
          priority: 'high',
          retryDelay: queueRetryDelay,
          retries: queueRetries,
          stepIndex: initialStepCount,
        });
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
  async queryUiMessages(agentState: AgentState): Promise<UIChatMessage[] | undefined> {
    const agentId: string | undefined = agentState?.metadata?.agentId;
    const topicId: string | undefined = agentState?.metadata?.topicId;
    // groupId scopes group conversations. Without it the query falls into the
    // standard branch (`groupId IS NULL`) and returns ZERO group messages, so
    // the step_start uiMessages snapshot would be empty and clobber the client.
    const groupId: string | undefined = agentState?.metadata?.groupId;
    if (!agentId || !topicId) return undefined;

    try {
      return await this.messageService.queryMessages({ agentId, groupId, topicId });
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
    } = params;

    // Group member timeout watchdog: enforce a member's deadline without claiming
    // the step lock. No-op if the member already finished; otherwise interrupt it
    // and bridge a `timeout` completion so the parked supervisor resumes/finishes.
    if (groupMemberTimeout) {
      return this.handleGroupMemberTimeout(groupMemberTimeout);
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
    const claimed = await this.coordinator.tryClaimStep(operationId, stepIndex, 35);
    if (!claimed) {
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

        const stepStartUiMessages = await this.queryUiMessages(agentState);
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

        // Enrich invoke_agent span with agent identity now that state is loaded.
        const stateAgentConfig = agentState.metadata?.agentConfig as
          | { description?: string | null; title?: string | null }
          | undefined;
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

        let beforeStepSignalEvents: Array<{ [key: string]: unknown; type: string }> = [];

        // Dispatch beforeStep hooks
        try {
          const beforeStepMetadata = agentState?.metadata || {};
          const beforeStepSignalEmission = await emitAgentSignalSourceEvent(
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
        const { runtime } = await this.createAgentRuntime({
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
        const stepResult = forcedFinishState
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

        // Check if the operation was interrupted while the step was executing
        // (e.g., user clicked abort during a long LLM call)
        const latestState = await this.coordinator.loadAgentState(operationId);
        if (latestState?.status === 'interrupted') {
          stepResult.newState.status = 'interrupted';
          stepResult.newState.lastModified = new Date().toISOString();
          log('[%s][%d] Operation was interrupted during step execution', operationId, stepIndex);
        }

        // Save state, coordinator will handle event sending automatically
        await this.coordinator.saveStepResult(operationId, {
          ...stepResult,
          executionTime: Date.now() - startAt,
          stepIndex, // placeholder
        });

        // Decide whether to schedule next step
        const shouldContinue = this.shouldContinueExecution(
          stepResult.newState,
          stepResult.nextContext,
        );
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

          afterStepSignalEvents = toAgentSignalSnapshotEvents(
            await emitAgentSignalSourceEvent(
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

          // Dispatch completion hooks
          await this.completionLifecycle.dispatchHooks(operationId, stepResult.newState, reason);

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
        }

        return {
          nextStepScheduled,
          state: stepResult.newState,
          stepResult,
          success: true,
        };
      });
    } catch (error) {
      invokeAgentSpan.recordException(error as Error);
      invokeAgentSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      invokeAgentSpan.setAttributes(
        buildInvokeAgentResultAttributes({ completionReason: 'error' }),
      );

      log('Step %d failed for operation %s: %O', stepIndex, operationId, error);
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

      // Dispatch onComplete + onError hooks
      await this.completionLifecycle.dispatchHooks(operationId, finalStateWithError, 'error');

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
          category: formattedError.category,
          countAsFailure: formattedError.countAsFailure,
          httpStatus: formattedError.httpStatus,
          message: formattedError.message ?? String(formattedError.type),
          numericId: formattedError.numericId,
          retryable: formattedError.retryable,
          severity: formattedError.severity,
          type: String(formattedError.type),
        },
        failedStep: { startedAt: stepStartAt, stepIndex },
        state: finalStateWithError,
      });

      throw error;
    } finally {
      invokeAgentSpan.end();
      // Release lock so legitimate retries or next operations can proceed.
      // If Vercel force-kills the process, this won't execute — the lock
      // auto-expires after TTL (35s), allowing QStash retries to self-heal.
      await this.coordinator.releaseStepLock(operationId, stepIndex);
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
      // State expired (Redis TTL) or never persisted — nothing left to resume.
      // Surface it: a missing state at completion time is how a parent silently
      // strands. There is no stepCount/status to arm a verify against.
      log('[%s] async-tool resume: parent state missing/expired, cannot resume', parentOperationId);
      asyncToolResumeCounter.add(1, { outcome: 'no_state' });
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
    state: AgentState,
    options?: { scheduleVerifyOnHold?: boolean; verifyAttempt?: number },
  ): Promise<void> {
    if (!options?.scheduleVerifyOnHold || !this.queueService) return;

    const status = state.status as string;
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
        status,
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
      status,
    );

    try {
      await this.queueService.scheduleMessage({
        context: undefined,
        delay,
        endpoint: `${this.baseURL}/run`,
        operationId: parentOperationId,
        payload: { asyncToolVerifyAttempt: attempt, verifyAsyncToolBarrier: true },
        priority: 'high',
        stepIndex: state.stepCount,
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
    const messages = Array.isArray(finalState?.messages) ? finalState.messages : [];
    const lastAssistant = [...messages]
      .reverse()
      .find((m: { role?: string }) => m?.role === 'assistant');
    const errorReason = failed ? formatSubAgentErrorReason(finalState?.error) : undefined;
    const content = failed
      ? errorReason
        ? `Sub-agent did not complete (${reason}): ${errorReason}`
        : `Sub-agent did not complete (${reason}).`
      : (lastAssistant?.content as string | undefined) ||
        'Sub-agent completed without a textual answer.';

    const backfill = await this.messageModel.updateToolMessage(toolMessageId, {
      content,
      pluginError: failed ? formatErrorForMetadata(finalState?.error) : undefined,
      pluginState: {
        model: finalState?.modelRuntimeConfig?.model,
        status: failed ? 'error' : 'completed',
        threadId,
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
    const messages = Array.isArray(finalState?.messages) ? finalState.messages : [];
    const lastAssistant = [...messages]
      .reverse()
      .find((m: { role?: string }) => m?.role === 'assistant');
    const agentLabel = (finalState?.metadata?.agentId as string | undefined) ?? 'member';
    const memberErrorReason = failed ? formatSubAgentErrorReason(finalState?.error) : undefined;
    const anchorContent = failed
      ? memberErrorReason
        ? `Agent member did not complete (${reason}): ${memberErrorReason}`
        : `Agent member did not complete (${reason}).`
      : mode === 'in_group'
        ? `Agent ${agentLabel} responded in the group.`
        : (lastAssistant?.content as string | undefined) ||
          'Agent member completed without a textual answer.';

    const anchorBackfill = await this.messageModel.updateToolMessage(anchorMessageId, {
      content: anchorContent,
      pluginError: failed ? formatErrorForMetadata(finalState?.error) : undefined,
      pluginState: {
        model: finalState?.modelRuntimeConfig?.model,
        status: failed ? 'error' : 'completed',
        threadId,
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

  /**
   * Reload the conversation messages from the database and flatten them for the
   * runtime. Used when resuming a parked op so the next LLM step sees tool
   * results written out-of-band (e.g. by a sub-agent completion bridge).
   */
  private async refreshMessagesFromDB(state: AgentState): Promise<AgentState['messages']> {
    let postProcessUrl: ((path: string | null) => Promise<string>) | undefined;
    try {
      const fileService = new FileService(this.serverDB, this.userId);
      postProcessUrl = (path: string | null) => fileService.getFullFileUrl(path);
    } catch {
      postProcessUrl = undefined;
    }

    const dbMessages = await this.messageModel.query(
      {
        agentId: state.metadata?.agentId,
        // Group runs must pass groupId, else the query filters `groupId IS NULL`
        // and returns no group messages — the next LLM step then gets an empty
        // context and the provider rejects it ("at least one message is required").
        groupId: state.metadata?.groupId,
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      },
      { postProcessUrl },
    );

    const { flatList } = parse(dbMessages);
    return flatList as AgentState['messages'];
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
    metadata,
    operationId,
    stepIndex,
    tracingContextEngine,
  }: {
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

    const agent = this.agentFactory
      ? this.agentFactory(generalConfig)
      : new GeneralChatAgent(generalConfig);

    // Create streaming executor context
    const executorContext: RuntimeExecutorContext = {
      agentConfig: metadata?.agentConfig,
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
      const dbMessages = await this.messageModel.query({
        agentId: state.metadata?.agentId,
        // Group runs need groupId or the query returns no group messages
        // (standard branch filters `groupId IS NULL`), losing the device context.
        groupId: state.metadata?.groupId,
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      });

      return findInMessages(
        dbMessages,
        (msg) => {
          const activeDeviceId = msg.pluginState?.metadata?.activeDeviceId;
          if (activeDeviceId) {
            return {
              activeDeviceId,
              devicePlatform: msg.pluginState?.metadata?.devicePlatform as string | undefined,
              deviceSystemInfo: msg.pluginState?.metadata?.deviceSystemInfo as
                | Record<string, string>
                | undefined,
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
