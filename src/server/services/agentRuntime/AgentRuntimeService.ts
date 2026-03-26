import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { AgentRuntime, findInMessages, GeneralChatAgent } from '@lobechat/agent-runtime';
import type { ISnapshotStore } from '@lobechat/agent-tracing';
import { dynamicInterventionAudits } from '@lobechat/builtin-tools/dynamicInterventionAudits';
import { AgentRuntimeErrorType, ChatErrorType, type ChatMessageError } from '@lobechat/types';
import debug from 'debug';
import urlJoin from 'url-join';

import { MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { type AgentRuntimeCoordinatorOptions } from '@/server/modules/AgentRuntime';
import { AgentRuntimeCoordinator, createStreamEventManager } from '@/server/modules/AgentRuntime';
import { type RuntimeExecutorContext } from '@/server/modules/AgentRuntime/RuntimeExecutors';
import { createRuntimeExecutors } from '@/server/modules/AgentRuntime/RuntimeExecutors';
import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { mcpService } from '@/server/services/mcp';
import { PluginGatewayService } from '@/server/services/pluginGateway';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';
import { ToolExecutionService } from '@/server/services/toolExecution';
import { BuiltinToolsExecutor } from '@/server/services/toolExecution/builtin';

import { isAbortError, throwIfAborted } from './abort';
import { hookDispatcher } from './hooks';
import {
  type AgentExecutionParams,
  type AgentExecutionResult,
  type OperationCreationParams,
  type OperationCreationResult,
  type OperationStatusResult,
  type PendingInterventionsResult,
  type StartExecutionParams,
  type StartExecutionResult,
  type StepCompletionReason,
  type StepLifecycleCallbacks,
  type StepPresentationData,
} from './types';

if (process.env.VERCEL) {
  // eslint-disable-next-line no-console
  debug.log = console.log.bind(console);
}

const log = debug('lobe-server:agent-runtime-service');

/**
 * Formats an error into ChatMessageError structure
 * Handles various error formats from LLM execution and other sources
 */
function formatErrorForState(error: unknown): ChatMessageError {
  // Handle ChatCompletionErrorPayload format from LLM errors
  // e.g., { errorType: 'InvalidProviderAPIKey', error: { ... }, provider: 'openai' }
  if (error && typeof error === 'object' && 'errorType' in error) {
    const payload = error as {
      error?: unknown;
      errorType: ChatMessageError['type'];
      message?: string;
    };
    return {
      body: payload.error || error,
      message: payload.message || String(payload.errorType),
      type: payload.errorType,
    };
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    return {
      body: { name: error.name },
      message: error.message,
      type: ChatErrorType.InternalServerError,
    };
  }

  // Fallback for unknown error types
  return {
    body: error,
    message: String(error),
    type: AgentRuntimeErrorType.AgentRuntimeError,
  };
}

export interface AgentRuntimeServiceOptions {
  /**
   * Coordinator configuration options
   * Allows injection of custom stateManager and streamEventManager
   */
  coordinatorOptions?: AgentRuntimeCoordinatorOptions;
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
  private coordinator: AgentRuntimeCoordinator;
  private streamManager: IStreamEventManager;
  private queueService: QueueService | null;
  private snapshotStore: ISnapshotStore | null;
  private toolExecutionService: ToolExecutionService;
  /**
   * Step lifecycle callback registry
   * key: operationId, value: callbacks
   */
  private stepCallbacks: Map<string, StepLifecycleCallbacks> = new Map();
  private get baseURL() {
    const baseUrl = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';

    return urlJoin(baseUrl, '/api/agent');
  }
  private serverDB: LobeChatDatabase;
  private userId: string;
  private messageModel: MessageModel;

  constructor(db: LobeChatDatabase, userId: string, options?: AgentRuntimeServiceOptions) {
    // Use factory function to auto-select Redis or InMemory implementation
    this.streamManager =
      options?.streamEventManager ??
      options?.coordinatorOptions?.streamEventManager ??
      createStreamEventManager();
    this.coordinator = new AgentRuntimeCoordinator({
      ...options?.coordinatorOptions,
      streamEventManager: this.streamManager,
    });
    this.queueService =
      options?.queueService === null ? null : (options?.queueService ?? new QueueService());
    this.snapshotStore = options?.snapshotStore ?? this.createDefaultSnapshotStore();
    this.serverDB = db;
    this.userId = userId;
    this.messageModel = new MessageModel(db, this.userId);

    // Initialize ToolExecutionService with dependencies
    const pluginGatewayService = new PluginGatewayService();
    const builtinToolsExecutor = new BuiltinToolsExecutor(db, userId);

    this.toolExecutionService = new ToolExecutionService({
      builtinToolsExecutor,
      mcpService,
      pluginGatewayService,
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
      impl.setExecutionCallback(async (operationId, stepIndex, context) => {
        await this.executeStep({ context, operationId, stepIndex });
      });
    }
  }

  // ==================== Step Lifecycle Callbacks ====================

  /**
   * Register step lifecycle callbacks
   * @param operationId - Operation ID
   * @param callbacks - Callback function collection
   */
  registerStepCallbacks(operationId: string, callbacks: StepLifecycleCallbacks): void {
    this.stepCallbacks.set(operationId, callbacks);
    log('[%s] Registered step callbacks', operationId);
  }

  /**
   * Remove step lifecycle callbacks
   * @param operationId - Operation ID
   */
  unregisterStepCallbacks(operationId: string): void {
    this.stepCallbacks.delete(operationId);
    log('[%s] Unregistered step callbacks', operationId);
  }

  /**
   * Get step lifecycle callbacks
   * @param operationId - Operation ID
   */
  getStepCallbacks(operationId: string): StepLifecycleCallbacks | undefined {
    return this.stepCallbacks.get(operationId);
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
      modelRuntimeConfig,
      userId,
      autoStart = true,
      stream,
      initialMessages = [],
      appContext,
      toolSet,
      stepCallbacks,
      hooks,
      userInterventionConfig,
      completionWebhook,
      stepWebhook,
      webhookDelivery,
      botPlatformContext,
      discordContext,
      evalContext,
      maxSteps,
      userMemory,
      deviceSystemInfo,
      operationSkillSet,
      signal,
      userTimezone,
    } = params;

    const operationToolSet = toolSet;
    let operationCreated = false;
    let stepCallbacksRegistered = false;
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
          botPlatformContext,
          completionWebhook,
          deviceSystemInfo,
          discordContext,
          evalContext,
          // need be removed
          modelRuntimeConfig,
          stepWebhook,
          stream,
          operationSkillSet,
          userId,
          userMemory,
          userTimezone,
          webhookDelivery,
          workingDirectory: agentConfig?.chatConfig?.runtimeEnv?.workingDirectory,
          ...appContext,
        },
        maxSteps,
        // modelRuntimeConfig at state level for executor fallback
        modelRuntimeConfig,
        operationId,
        operationToolSet,
        status: 'idle',
        stepCount: 0,
        // Backward-compat: resolved tool fields read by RuntimeExecutors
        toolManifestMap: operationToolSet.manifestMap,
        toolSourceMap: operationToolSet.sourceMap,
        tools: operationToolSet.tools,
        // User intervention config for headless mode in async tasks
        userInterventionConfig,
      } as Partial<AgentState>;

      // Use coordinator to create operation, automatically sends initialization event
      await this.coordinator.createAgentOperation(operationId, {
        agentConfig,
        modelRuntimeConfig,
        userId,
      });
      operationCreated = true;

      // Save initial state
      await this.coordinator.saveAgentState(operationId, initialState as any);

      // Register step lifecycle callbacks
      if (stepCallbacks) {
        this.registerStepCallbacks(operationId, stepCallbacks);
        stepCallbacksRegistered = true;
      }

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
          stepIndex: 0,
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
        if (stepCallbacksRegistered) {
          this.unregisterStepCallbacks(operationId);
        }

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
   * Execute Agent step
   */
  async executeStep(params: AgentExecutionParams): Promise<AgentExecutionResult> {
    const { operationId, stepIndex, context, humanInput, approvedToolCall, rejectionReason } =
      params;

    const callbacks = this.getStepCallbacks(operationId);

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

    try {
      log('[%s][%d] Start step executing...', operationId, stepIndex);

      // Publish step start event
      await this.streamManager.publishStreamEvent(operationId, {
        data: {},
        stepIndex,
        type: 'step_start',
      });

      // Get operation state and metadata
      const agentState = await this.coordinator.loadAgentState(operationId);

      if (!agentState) {
        throw new Error(`Agent state not found for operation ${operationId}`);
      }

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

        // Trigger completion callback so eval run can finalize properly
        if (callbacks?.onComplete) {
          try {
            await callbacks.onComplete({
              finalState: agentState,
              operationId,
              reason,
            });
            this.unregisterStepCallbacks(operationId);
          } catch (callbackError) {
            log('[%s] onComplete callback error: %O', operationId, callbackError);
          }
        }

        return {
          nextStepScheduled: false,
          state: agentState,
          stepResult: null,
          success: true,
        };
      }

      // Call onBeforeStep callback (legacy)
      if (callbacks?.onBeforeStep) {
        try {
          await callbacks.onBeforeStep({
            context,
            operationId,
            state: agentState,
            stepIndex,
          });
        } catch (callbackError) {
          log('[%s] onBeforeStep callback error: %O', operationId, callbackError);
        }
      }

      // Dispatch beforeStep hooks
      try {
        const beforeStepMetadata = agentState?.metadata || {};
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

      // Create Agent and Runtime instances
      // Use agentState.metadata which contains the full app context (topicId, agentId, etc.)
      // operationMetadata only contains basic fields (agentConfig, modelRuntimeConfig, userId)
      const { runtime } = await this.createAgentRuntime({
        metadata: agentState?.metadata,
        operationId,
        stepIndex,
      });

      // Handle human intervention
      let currentContext = context;
      let currentState = agentState;

      if (humanInput || approvedToolCall || rejectionReason) {
        const interventionResult = await this.handleHumanIntervention(runtime, currentState, {
          approvedToolCall,
          humanInput,
          rejectionReason,
        });
        currentState = interventionResult.newState;
        currentContext = interventionResult.nextContext;
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

      // Execute step
      const startAt = Date.now();
      const stepResult = await runtime.step(currentState, currentContext);

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
      const { usage, cost } = stepResult.newState;
      const phase = stepResult.nextContext?.phase;
      const isToolPhase = phase === 'tool_result' || phase === 'tools_batch_result';

      // --- Extract presentation fields from step result ---
      let content: string | undefined;
      let reasoning: string | undefined;
      let toolsCalling:
        | Array<{ apiName: string; arguments?: string; identifier: string }>
        | undefined;
      let toolsResult:
        | Array<{ apiName: string; identifier: string; isSuccess?: boolean; output?: string }>
        | undefined;
      let stepSummary: string;

      if (phase === 'tool_result') {
        const toolPayload = stepResult.nextContext?.payload as any;
        const toolCall = toolPayload?.toolCall;
        const identifier = toolCall?.identifier || 'unknown';
        const apiName = toolCall?.apiName || 'unknown';
        const output = toolPayload?.data;
        toolsResult = [
          {
            apiName,
            identifier,
            isSuccess: toolPayload?.isSuccess !== false,
            output:
              typeof output === 'string'
                ? output
                : output != null
                  ? JSON.stringify(output)
                  : undefined,
          },
        ];
        stepSummary = `[tool] ${identifier}/${apiName}`;
      } else if (phase === 'tools_batch_result') {
        const nextPayload = stepResult.nextContext?.payload as any;
        const toolCount = nextPayload?.toolCount || 0;
        const rawToolResults = nextPayload?.toolResults || [];
        const mappedResults: Array<{
          apiName: string;
          identifier: string;
          isSuccess?: boolean;
          output?: string;
        }> = rawToolResults.map((r: any) => {
          const tc = r.toolCall;
          const output = r.data;
          return {
            apiName: tc?.apiName || 'unknown',
            identifier: tc?.identifier || 'unknown',
            isSuccess: r?.isSuccess !== false,
            output:
              typeof output === 'string'
                ? output
                : output != null
                  ? JSON.stringify(output)
                  : undefined,
          };
        });
        toolsResult = mappedResults;
        const toolNames = mappedResults.map((r) => `${r.identifier}/${r.apiName}`);
        stepSummary = `[tools×${toolCount}] ${toolNames.join(', ')}`;
      } else {
        // Check for done event first (finish step with no next context)
        const doneEvent = stepResult.events?.find((e) => e.type === 'done') as
          | { reason?: string; reasonDetail?: string; type: 'done' }
          | undefined;

        if (doneEvent) {
          stepSummary = `[done] reason=${doneEvent.reason ?? 'unknown'}`;
        } else {
          // LLM result
          const llmEvent = stepResult.events?.find((e) => e.type === 'llm_result');
          content = (llmEvent as any)?.result?.content || undefined;
          reasoning = (llmEvent as any)?.result?.reasoning || undefined;

          // Use parsed ChatToolPayload from payload (has identifier + apiName)
          const payloadToolsCalling = (stepResult.nextContext?.payload as any)?.toolsCalling as
            | Array<{ apiName: string; arguments: string; identifier: string }>
            | undefined;
          const hasToolCalls = Array.isArray(payloadToolsCalling) && payloadToolsCalling.length > 0;

          if (hasToolCalls) {
            toolsCalling = payloadToolsCalling.map((tc) => ({
              apiName: tc.apiName,
              arguments: tc.arguments,
              identifier: tc.identifier,
            }));
          }

          const parts: string[] = [];
          if (reasoning) {
            const thinkPreview = reasoning.length > 30 ? reasoning.slice(0, 30) + '...' : reasoning;
            parts.push(`💭 "${thinkPreview}"`);
          }
          if (!content && hasToolCalls) {
            parts.push(
              `→ call tools: ${toolsCalling!.map((tc) => `${tc.identifier}|${tc.apiName}`).join(', ')}`,
            );
          } else if (content) {
            const preview = content.length > 20 ? content.slice(0, 20) + '...' : content;
            parts.push(`"${preview}"`);
          }
          if (parts.length > 0) {
            stepSummary = `[llm] ${parts.join(' | ')}`;
          } else {
            stepSummary = `[llm] (empty) phase=${stepResult.nextContext?.phase ?? 'none'} events=${stepResult.events?.length ?? 0}`;
          }
        }
      }

      // --- Step-level usage from nextContext.stepUsage ---
      const stepUsage = stepResult.nextContext?.stepUsage as Record<string, number> | undefined;

      // --- Cumulative usage ---
      const tokens = usage?.llm?.tokens;
      const totalInputTokens = tokens?.input ?? 0;
      const totalOutputTokens = tokens?.output ?? 0;
      const totalTokensNum = tokens?.total ?? 0;
      const totalCostNum = cost?.total ?? 0;

      const totalTokensStr =
        totalTokensNum >= 1_000_000
          ? `${(totalTokensNum / 1_000_000).toFixed(1)}m`
          : totalTokensNum >= 1000
            ? `${(totalTokensNum / 1000).toFixed(1)}k`
            : String(totalTokensNum);
      const llmCalls = usage?.llm?.apiCalls ?? 0;
      const toolCallCount = usage?.tools?.totalCalls ?? 0;

      log(
        '[%s][%d] completed %s | total: %s tokens / $%s | llm×%d | tools×%d',
        operationId,
        stepIndex,
        stepSummary,
        totalTokensStr,
        totalCostNum.toFixed(4),
        llmCalls,
        toolCallCount,
      );

      // Build presentation data object for callbacks and webhooks
      const stepPresentationData: StepPresentationData = {
        content,
        executionTimeMs: Date.now() - startAt,
        reasoning,
        stepCost: stepUsage?.cost ?? undefined,
        stepInputTokens: stepUsage?.totalInputTokens ?? undefined,
        stepOutputTokens: stepUsage?.totalOutputTokens ?? undefined,
        stepTotalTokens: stepUsage?.totalTokens ?? undefined,
        stepType: isToolPhase ? ('call_tool' as const) : ('call_llm' as const),
        thinking: !isToolPhase,
        toolsCalling,
        toolsResult,
        totalCost: totalCostNum,
        totalInputTokens,
        totalOutputTokens,
        totalSteps: stepResult.newState.stepCount ?? 0,
        totalTokens: totalTokensNum,
      };

      // Call onAfterStep callback with presentation data (legacy)
      if (callbacks?.onAfterStep) {
        try {
          await callbacks.onAfterStep({
            ...stepPresentationData,
            operationId,
            shouldContinue,
            state: stepResult.newState,
            stepIndex,
            stepResult,
          });
        } catch (callbackError) {
          log('[%s] onAfterStep callback error: %O', operationId, callbackError);
        }
      }

      // Dispatch afterStep hooks
      try {
        const metadata = stepResult.newState?.metadata || {};
        await hookDispatcher.dispatch(
          operationId,
          'afterStep',
          {
            agentId: metadata?.agentId || '',
            finalState: stepResult.newState,
            operationId,
            shouldContinue,
            status: stepResult.newState?.status,
            stepIndex,
            steps: stepResult.newState?.stepCount || 0,
            userId: metadata?.userId || this.userId,
          },
          metadata._hooks,
        );
      } catch (hookError) {
        log('[%s] afterStep hook dispatch error: %O', operationId, hookError);
      }

      // Record step snapshot via injected snapshot store
      if (this.snapshotStore) {
        try {
          const partial = (await this.snapshotStore.loadPartial(operationId)) ?? { steps: [] };

          if (!partial.startedAt) {
            partial.startedAt = Date.now();
            partial.model =
              (agentState?.metadata as any)?.agentConfig?.model ??
              agentState?.modelRuntimeConfig?.model;
            partial.provider =
              (agentState?.metadata as any)?.agentConfig?.provider ??
              agentState?.modelRuntimeConfig?.provider;
          }

          if (!partial.steps) partial.steps = [];

          // Incremental diff: only store message delta + baseline at reset points
          const prevMessages = agentState?.messages ?? [];
          const afterMessages = stepResult.newState.messages;
          const isCompression = stepResult.events?.some(
            (e: any) => e.type === 'compression_complete',
          );
          const isBaseline = stepIndex === 0 || isCompression;
          // Always store only the newly added messages, even for baseline steps
          const messagesDelta = afterMessages.slice(prevMessages.length);

          // Strip heavy/redundant data from events before persisting to snapshot
          const snapshotEvents = (stepResult.events as any[])
            ?.filter((e) => e.type !== 'llm_stream')
            .map((e) => {
              if (e.type === 'done' && e.finalState) {
                // Remove reconstructible fields from finalState:
                // - messages: from messagesBaseline + messagesDelta chain
                // - operationToolSet: from toolsetBaseline (step 0)
                // - toolManifestMap/tools/toolSourceMap: backward-compat copies of operationToolSet
                const {
                  messages: _msgs,
                  operationToolSet: _ots,
                  toolManifestMap: _tmm,
                  toolSourceMap: _tsm,
                  tools: _tools,
                  // activatedStepTools is kept since it's the cumulative record
                  ...restState
                } = e.finalState;
                return { ...e, finalState: restState };
              }
              return e;
            });

          // Strip toolResults from payload (already in step.toolsResult)
          let snapshotPayload: unknown = currentContext?.payload;
          if (
            snapshotPayload &&
            typeof snapshotPayload === 'object' &&
            'toolResults' in snapshotPayload
          ) {
            const { toolResults: _tr, ...restPayload } = snapshotPayload as Record<string, unknown>;
            snapshotPayload = restPayload;
          }

          // Compute activatedStepTools delta (newly discovered tools in this step)
          const prevActivated = agentState?.activatedStepTools ?? [];
          const afterActivated = stepResult.newState.activatedStepTools ?? [];
          const activatedStepToolsDelta =
            afterActivated.length > prevActivated.length
              ? afterActivated.slice(prevActivated.length)
              : undefined;

          partial.steps.push({
            activatedStepToolsDelta,
            completedAt: Date.now(),
            content: stepPresentationData.content,
            context: {
              payload: snapshotPayload,
              phase: currentContext?.phase ?? 'unknown',
              stepContext: currentContext?.stepContext,
            },
            events: snapshotEvents,
            executionTimeMs: stepPresentationData.executionTimeMs,
            inputTokens: stepPresentationData.stepInputTokens,
            isCompressionReset: isCompression || undefined,
            messagesBaseline: isBaseline ? prevMessages : undefined,
            messagesDelta,
            outputTokens: stepPresentationData.stepOutputTokens,
            reasoning: stepPresentationData.reasoning,
            startedAt: startAt,
            stepIndex,
            stepType: stepPresentationData.stepType,
            // Store operation-level toolset once at step 0
            toolsetBaseline: stepIndex === 0 ? agentState?.operationToolSet : undefined,
            toolsCalling: stepPresentationData.toolsCalling,
            toolsResult: stepPresentationData.toolsResult,
            totalCost: stepPresentationData.totalCost,
            totalTokens: stepPresentationData.totalTokens,
          });

          await this.snapshotStore.savePartial(operationId, partial);
        } catch (e) {
          log('[%s] snapshot step recording failed: %O', operationId, e);
        }
      }

      // Update step tracking in state metadata and trigger step webhook
      if (stepResult.newState.metadata?.stepWebhook) {
        const prevTracking = stepResult.newState.metadata._stepTracking || {};
        const newTotalToolCalls = (prevTracking.totalToolCalls ?? 0) + (toolsCalling?.length ?? 0);

        // Truncate content to 1800 chars to match Discord message limits
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

        // Fire step webhook (include shouldContinue so the callback knows
        // whether the agent is still running or about to complete)
        await this.triggerStepWebhook(stepResult.newState, operationId, {
          ...stepPresentationData,
          shouldContinue,
        } as unknown as Record<string, unknown>);
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
          stepIndex: nextStepIndex,
        });
        nextStepScheduled = true;

        log('[%s][%d] Scheduled next step %d', operationId, stepIndex, nextStepIndex);
      }

      // Check if operation is complete
      if (!shouldContinue) {
        const reason = this.determineCompletionReason(stepResult.newState);

        // Trigger completion webhook (fire-and-forget)
        await this.triggerCompletionWebhook(stepResult.newState, operationId, reason);

        // Dispatch onComplete hooks
        await this.dispatchCompletionHooks(operationId, stepResult.newState, reason);

        // Call onComplete callback (legacy)
        if (callbacks?.onComplete) {
          try {
            await callbacks.onComplete({
              finalState: stepResult.newState,
              operationId,
              reason,
            });
            // Clean up callbacks after operation completes
            this.unregisterStepCallbacks(operationId);
          } catch (callbackError) {
            log('[%s] onComplete callback error: %O', operationId, callbackError);
          }
        }

        // Finalize tracing snapshot via injected snapshot store
        if (this.snapshotStore) {
          try {
            const partial = await this.snapshotStore.loadPartial(operationId);

            if (partial) {
              const metadata = agentState?.metadata as any;
              const snapshot = {
                agentId: metadata?.agentId,
                completedAt: Date.now(),
                completionReason: reason,
                error: stepResult.newState.error
                  ? {
                      message: String(
                        stepResult.newState.error.message ?? stepResult.newState.error,
                      ),
                      type: String(stepResult.newState.error.type ?? 'unknown'),
                    }
                  : undefined,
                model: partial.model,
                operationId,
                provider: partial.provider,
                startedAt: partial.startedAt ?? Date.now(),
                steps: (partial.steps ?? []).sort((a, b) => a.stepIndex - b.stepIndex),
                totalCost: stepResult.newState.cost?.total ?? 0,
                totalSteps: stepResult.newState.stepCount,
                totalTokens: stepResult.newState.usage?.llm?.tokens?.total ?? 0,
                topicId: metadata?.topicId,
                traceId: operationId,
                userId: metadata?.userId,
              };

              await this.snapshotStore.save(snapshot as any);
              await this.snapshotStore.removePartial(operationId);
            }
          } catch (e) {
            log('[%s] snapshot finalization failed: %O', operationId, e);
          }
        }
      }

      return {
        nextStepScheduled,
        state: stepResult.newState,
        stepResult,
        success: true,
      };
    } catch (error) {
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
          status: 'error' as const,
          stepCount: errorState?.stepCount ?? stepIndex,
        };
      } catch (loadError) {
        log('[%s] Failed to load error state (infra may be down): %O', operationId, loadError);
        // Fallback: construct a minimal error state so callbacks still receive useful info
        finalStateWithError = {
          error: formattedError,
          status: 'error' as const,
          stepCount: stepIndex,
        };
      }

      try {
        await this.coordinator.saveAgentState(operationId, finalStateWithError);
      } catch (saveError) {
        log('[%s] Failed to save error state (infra may be down): %O', operationId, saveError);
      }

      // Trigger completion webhook on error (fire-and-forget)
      try {
        await this.triggerCompletionWebhook(finalStateWithError, operationId, 'error');
      } catch (webhookError) {
        log('[%s] Failed to trigger completion webhook: %O', operationId, webhookError);
      }

      // Dispatch onComplete + onError hooks
      await this.dispatchCompletionHooks(operationId, finalStateWithError, 'error');

      // Also call onComplete callback when execution fails (legacy)
      if (callbacks?.onComplete) {
        try {
          await callbacks.onComplete({
            finalState: finalStateWithError,
            operationId,
            reason: 'error',
          });
          this.unregisterStepCallbacks(operationId);
        } catch (callbackError) {
          log('[%s] onComplete callback error in catch: %O', operationId, callbackError);
        }
      }

      throw error;
    } finally {
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
        isActive: ['running', 'waiting_for_human'].includes(currentState.status),
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
    action: 'approve' | 'reject' | 'input' | 'select';
    approvedToolCall?: any;
    humanInput?: any;
    operationId: string;
    rejectionReason?: string;
    stepIndex: number;
  }): Promise<{ messageId?: string }> {
    const { operationId, stepIndex, action, approvedToolCall, humanInput, rejectionReason } =
      params;

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
          payload: { approvedToolCall, humanInput, rejectionReason },
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
   * Create Agent Runtime instance
   */
  private async createAgentRuntime({
    metadata,
    operationId,
    stepIndex,
  }: {
    metadata?: any;
    operationId: string;
    stepIndex: number;
  }) {
    // Create Durable Agent instance
    const agent = new GeneralChatAgent({
      agentConfig: metadata?.agentConfig,
      compressionConfig: {
        enabled: metadata?.agentConfig?.chatConfig?.enableContextCompression ?? true,
      },
      dynamicInterventionAudits,
      modelRuntimeConfig: metadata?.modelRuntimeConfig,
      operationId,
      userId: metadata?.userId,
    });

    // Create streaming executor context
    const executorContext: RuntimeExecutorContext = {
      agentConfig: metadata?.agentConfig,
      botPlatformContext: metadata?.botPlatformContext,
      discordContext: metadata?.discordContext,
      userTimezone: metadata?.userTimezone,
      evalContext: metadata?.evalContext,
      messageModel: this.messageModel,
      operationId,
      serverDB: this.serverDB,
      stepIndex,
      stream: metadata?.stream,
      streamManager: this.streamManager,
      toolExecutionService: this.toolExecutionService,
      topicId: metadata?.topicId,
      userId: metadata?.userId,
    };

    // Create Agent Runtime instance
    const runtime = new AgentRuntime(agent as any, {
      executors: createRuntimeExecutors(executorContext),
    });

    return { agent, runtime };
  }

  /**
   * Create default snapshot store based on environment.
   * - ENABLE_AGENT_S3_TRACING=1 → S3SnapshotStore
   * - NODE_ENV=development → FileSnapshotStore
   * - Otherwise → null (no tracing)
   */
  private createDefaultSnapshotStore(): ISnapshotStore | null {
    if (process.env.ENABLE_AGENT_S3_TRACING === '1') {
      try {
        const { S3SnapshotStore } = require('@/server/modules/AgentTracing');
        return new S3SnapshotStore();
      } catch {
        // S3SnapshotStore not available
      }
    }

    if (process.env.NODE_ENV === 'development') {
      try {
        const { FileSnapshotStore } = require('@lobechat/agent-tracing');
        return new FileSnapshotStore();
      } catch {
        // agent-tracing not available
      }
    }

    return null;
  }

  /**
   * Compute device context from DB messages at step boundary.
   * Uses findInMessages visitor to scan tool messages for device activation.
   */
  private async computeDeviceContext(state: any) {
    try {
      const dbMessages = await this.messageModel.query({
        agentId: state.metadata?.agentId,
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
   * Handle human intervention logic
   */
  private async handleHumanIntervention(
    runtime: AgentRuntime,
    state: any,
    intervention: { approvedToolCall?: any; humanInput?: any; rejectionReason?: string },
  ) {
    const { humanInput, approvedToolCall, rejectionReason } = intervention;

    if (approvedToolCall && state.status === 'waiting_for_human') {
      // TODO: implement approveToolCall logic
      return { newState: state, nextContext: undefined };
    } else if (rejectionReason && state.status === 'waiting_for_human') {
      // TODO: implement rejectToolCall logic
      return { newState: state, nextContext: undefined };
    } else if (humanInput) {
      // TODO: implement processHumanInput logic
      return { newState: state, nextContext: undefined };
    }

    return { newState: state, nextContext: undefined };
  }

  /**
   * Deliver a webhook payload via fetch or QStash.
   * Fire-and-forget: errors are logged but never thrown.
   */
  private async deliverWebhook(
    url: string,
    payload: Record<string, unknown>,
    delivery: 'fetch' | 'qstash' = 'fetch',
    operationId: string,
  ): Promise<void> {
    try {
      if (delivery === 'qstash') {
        const { Client } = await import('@upstash/qstash');
        const client = new Client({ token: process.env.QSTASH_TOKEN! });
        await client.publishJSON({
          body: payload,
          headers: {
            ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
              'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
            }),
          },
          url,
        });
      } else {
        await fetch(url, {
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
      }
    } catch (error) {
      console.error('[%s] Webhook delivery failed (%s → %s):', operationId, delivery, url, error);
    }
  }

  /**
   * Dispatch onComplete (and onError) hooks via HookDispatcher.
   * Fire-and-forget: errors are logged but never thrown.
   */
  private async dispatchCompletionHooks(
    operationId: string,
    state: any,
    reason: string,
  ): Promise<void> {
    try {
      const metadata = state?.metadata || {};

      // Extract last assistant content (same as triggerCompletionWebhook)
      const lastAssistantContent = state?.messages
        ?.slice()
        .reverse()
        .find(
          (m: { content?: string; role: string }) => m.role === 'assistant' && m.content,
        )?.content;

      const duration = state?.createdAt
        ? Date.now() - new Date(state.createdAt).getTime()
        : undefined;

      const event = {
        agentId: metadata?.agentId || '',
        cost: state?.cost?.total,
        duration,
        errorDetail: state?.error,
        errorMessage: this.extractErrorMessage?.(state?.error) || String(state?.error || ''),
        // Full state available in local mode only (not serialized to webhooks)
        finalState: state,
        lastAssistantContent,
        llmCalls: state?.usage?.llm?.apiCalls,
        operationId,
        reason,
        status: state?.status || reason,
        steps: state?.stepCount || 0,
        toolCalls: state?.usage?.tools?.totalCalls,
        topicId: metadata?.topicId,
        totalTokens: state?.usage?.llm?.tokens?.total,
        userId: metadata?.userId || this.userId,
      };

      // Dispatch onComplete hooks
      await hookDispatcher.dispatch(operationId, 'onComplete', event, metadata._hooks);

      // Also dispatch onError hooks if reason is error
      if (reason === 'error') {
        await hookDispatcher.dispatch(operationId, 'onError', event, metadata._hooks);
      }

      // Cleanup hooks after completion
      hookDispatcher.unregister(operationId);
    } catch (error) {
      log('[%s] Hook dispatch error (non-fatal): %O', operationId, error);
    }
  }

  /**
   * Trigger completion webhook if configured in state metadata.
   * Fire-and-forget: errors are logged but never thrown.
   */
  private async triggerCompletionWebhook(
    state: any,
    operationId: string,
    reason: StepCompletionReason,
  ): Promise<void> {
    const webhook = state.metadata?.completionWebhook;
    if (!webhook?.url) return;

    log('[%s] Triggering completion webhook: %s', operationId, webhook.url);

    const duration = state.createdAt ? Date.now() - new Date(state.createdAt).getTime() : undefined;

    // Extract last assistant content from state messages
    const lastAssistantContent = state.messages
      ?.slice()
      .reverse()
      .find(
        (m: { content?: string; role: string }) => m.role === 'assistant' && m.content,
      )?.content;

    // Extract first user prompt for downstream consumers (e.g., topic title summarization)
    const userPrompt = state.messages?.find(
      (m: { content?: string; role: string }) => m.role === 'user',
    )?.content;

    const delivery = state.metadata?.webhookDelivery || 'fetch';

    await this.deliverWebhook(
      webhook.url,
      {
        ...webhook.body,
        cost: state.cost?.total,
        duration,
        errorDetail: state.error,
        errorMessage: this.extractErrorMessage(state.error),
        lastAssistantContent,
        llmCalls: state.usage?.llm?.apiCalls,
        operationId,
        reason,
        status: state.status,
        steps: state.stepCount,
        toolCalls: state.usage?.tools?.totalCalls,
        topicId: state.metadata?.topicId,
        totalTokens: state.usage?.llm?.tokens?.total,
        type: 'completion',
        userId: state.metadata?.userId,
        userPrompt,
      },
      delivery,
      operationId,
    );
  }

  /**
   * Trigger step webhook if configured in state metadata.
   * Reads accumulated step tracking data and fires webhook with step presentation data.
   * Fire-and-forget: errors are logged but never thrown.
   */
  private async triggerStepWebhook(
    state: any,
    operationId: string,
    presentationData: Record<string, unknown>,
  ): Promise<void> {
    const webhook = state.metadata?.stepWebhook;
    if (!webhook?.url) return;

    log('[%s] Triggering step webhook: %s', operationId, webhook.url);

    const tracking = state.metadata?._stepTracking || {};
    const delivery = state.metadata?.webhookDelivery || 'fetch';
    const elapsedMs = state.createdAt
      ? Date.now() - new Date(state.createdAt).getTime()
      : undefined;

    await this.deliverWebhook(
      webhook.url,
      {
        ...webhook.body,
        ...presentationData,
        elapsedMs,
        lastLLMContent: tracking.lastLLMContent,
        lastToolsCalling: tracking.lastToolsCalling,
        operationId,
        totalToolCalls: tracking.totalToolCalls ?? 0,
        type: 'step',
      },
      delivery,
      operationId,
    );
  }

  /**
   * Extract a human-readable error message from the agent state error object.
   * Handles both raw ChatCompletionErrorPayload (from runtime.step catch) and
   * formatted ChatMessageError (from executeStep catch).
   */
  private extractErrorMessage(error: any): string | undefined {
    if (!error) return undefined;

    // Path B: formatted ChatMessageError — { body, message, type }
    // Try to extract meaningful info from body first
    if (error.body) {
      const body = error.body;
      // OpenAI-style: body.error.message
      if (body.error?.message) return body.error.message;
      // Direct message on body
      if (body.message) return body.message;
    }

    // Path A: raw ChatCompletionErrorPayload — { errorType, error: {...}, provider }
    if (error.error) {
      const inner = error.error;
      if (inner.error?.message) return inner.error.message;
      if (inner.message) return inner.message;
    }

    // Fallback to message or type
    if (error.message && error.message !== 'error') return error.message;
    if (error.type || error.errorType) return String(error.type || error.errorType);

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

      // Check if human intervention is needed
      if (state.status === 'waiting_for_human') {
        log('[%s] Sync execution paused: waiting for human intervention', operationId);
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
      // If stopped due to executeSync's maxSteps limit, need to manually call onComplete
      // Note: If stopped due to state.maxSteps being reached, onComplete has already been called in executeStep
      const callbacks = this.getStepCallbacks(operationId);
      if (callbacks?.onComplete && state.status !== 'done' && state.status !== 'error') {
        try {
          await callbacks.onComplete({
            finalState: state,
            operationId,
            reason: 'max_steps',
          });
          this.unregisterStepCallbacks(operationId);
        } catch (callbackError) {
          log('[%s] onComplete callback error in executeSync: %O', operationId, callbackError);
        }
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
