import { type AgentRuntimeContext, type AgentState } from '@lobechat/agent-runtime';
import { AgentRuntime, GeneralChatAgent } from '@lobechat/agent-runtime';
import { type ChatMessageError } from '@lobechat/types';
import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
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
import { dynamicInterventionAudits } from '@/tools/dynamicInterventionAudits';

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
} from './types';

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
        log('[%s] Local callback executing step %d', operationId, stepIndex);
        await this.executeStep({
          context,
          operationId,
          stepIndex,
        });
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

  // ==================== Operation Management ====================

  /**
   * Create a new Agent operation
   */
  async createOperation(params: OperationCreationParams): Promise<OperationCreationResult> {
    const {
      operationId,
      initialContext,
      agentConfig,
      modelRuntimeConfig,
      userId,
      autoStart = true,
      tools,
      initialMessages = [],
      appContext,
      toolManifestMap,
      toolSourceMap,
      stepCallbacks,
      userInterventionConfig,
    } = params;

    try {
      log('[%s] Creating new operation (autoStart: %s)', operationId, autoStart);

      // Initialize operation state - create state before saving
      const initialState = {
        createdAt: new Date().toISOString(),
        // Store initialContext for executeSync to use
        initialContext,
        lastModified: new Date().toISOString(),
        // Use the passed initial messages
        messages: initialMessages,
        metadata: {
          agentConfig,
          // need be removed
          modelRuntimeConfig,
          userId,
          workingDirectory: agentConfig?.chatConfig?.localSystem?.workingDirectory,
          ...appContext,
        },
        // modelRuntimeConfig at state level for executor fallback
        modelRuntimeConfig,
        operationId,
        status: 'idle',
        stepCount: 0,
        toolManifestMap,
        toolSourceMap,
        tools,
        // User intervention config for headless mode in async tasks
        userInterventionConfig,
      } as Partial<AgentState>;

      // Use coordinator to create operation, automatically sends initialization event
      await this.coordinator.createAgentOperation(operationId, {
        agentConfig,
        modelRuntimeConfig,
        userId,
      });

      // Save initial state
      await this.coordinator.saveAgentState(operationId, initialState as any);

      // Register step lifecycle callbacks
      if (stepCallbacks) {
        this.registerStepCallbacks(operationId, stepCallbacks);
      }

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

    // Get registered callbacks
    const callbacks = this.getStepCallbacks(operationId);

    try {
      log('[%s] Executing step %d', operationId, stepIndex);

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

      // Call onBeforeStep callback
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

      // Execute step
      const startAt = Date.now();
      const stepResult = await runtime.step(currentState, currentContext);

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

      log('[%s] Step %d completed', operationId, stepIndex);

      // Call onAfterStep callback
      if (callbacks?.onAfterStep) {
        try {
          await callbacks.onAfterStep({
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

        log('[%s] Scheduled next step %d', operationId, nextStepIndex);
      }

      // Check if operation is complete, call onComplete callback
      if (!shouldContinue && callbacks?.onComplete) {
        const reason = this.determineCompletionReason(stepResult.newState);
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

      return {
        nextStepScheduled,
        state: stepResult.newState,
        stepResult,
        success: true,
      };
    } catch (error) {
      log('Step %d failed for operation %s: %O', stepIndex, operationId, error);

      // Publish error event
      await this.streamManager.publishStreamEvent(operationId, {
        data: {
          error: (error as Error).message,
          phase: 'step_execution',
          stepIndex,
        },
        stepIndex,
        type: 'error',
      });

      // Build and save error state so it's persisted for later retrieval
      const errorState = await this.coordinator.loadAgentState(operationId);
      const finalStateWithError = {
        ...errorState!,
        error: formatErrorForState(error),
        status: 'error' as const,
      };

      // Save the error state to coordinator so getOperationStatus can retrieve it
      await this.coordinator.saveAgentState(operationId, finalStateWithError);

      // Also call onComplete callback when execution fails
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
      messageModel: this.messageModel,
      operationId,
      serverDB: this.serverDB,
      stepIndex,
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

    // Reached maximum steps
    if (state.maxSteps && state.stepCount >= state.maxSteps) return false;

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
    const { maxSteps = 9999, onStepComplete, initialContext } = options ?? {};

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
      log('[%s] Executing step %d', operationId, stepIndex);
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
