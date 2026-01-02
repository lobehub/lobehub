import {
  AgentRuntime,
  type AgentRuntimeContext,
  type AgentState,
  GeneralChatAgent,
} from '@lobechat/agent-runtime';
import debug from 'debug';
import urlJoin from 'url-join';

import { MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import {
  AgentRuntimeCoordinator,
  type AgentRuntimeCoordinatorOptions,
  createStreamEventManager,
} from '@/server/modules/AgentRuntime';
import {
  type RuntimeExecutorContext,
  createRuntimeExecutors,
} from '@/server/modules/AgentRuntime/RuntimeExecutors';
import type { IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { mcpService } from '@/server/services/mcp';
import { PluginGatewayService } from '@/server/services/pluginGateway';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';
import { ToolExecutionService } from '@/server/services/toolExecution';
import { BuiltinToolsExecutor } from '@/server/services/toolExecution/builtin';

import type {
  AgentExecutionParams,
  AgentExecutionResult,
  OperationCreationParams,
  OperationCreationResult,
  OperationStatusResult,
  PendingInterventionsResult,
  StartExecutionParams,
  StartExecutionResult,
  StepCompletionReason,
  StepLifecycleCallbacks,
} from './types';

const log = debug('lobe-server:agent-runtime-service');

export interface AgentRuntimeServiceOptions {
  /**
   * Coordinator 配置选项
   * 可以注入自定义的 stateManager 和 streamEventManager
   */
  coordinatorOptions?: AgentRuntimeCoordinatorOptions;
  /**
   * 自定义 QueueService
   * 设置为 null 时禁用队列调度（用于同步执行测试）
   */
  queueService?: QueueService | null;
  /**
   * 自定义 StreamEventManager
   * 默认使用 Redis 实现的 StreamEventManager
   * 测试环境可以传入 InMemoryStreamEventManager
   */
  streamEventManager?: IStreamEventManager;
}

/**
 * Agent Runtime Service
 * 封装 Agent 执行相关的逻辑，提供统一的服务接口
 *
 * 支持依赖注入，可以使用内存实现进行测试：
 * ```ts
 * // 生产环境（默认使用 Redis）
 * const service = new AgentRuntimeService(db, userId);
 *
 * // 测试环境
 * const service = new AgentRuntimeService(db, userId, {
 *   streamEventManager: new InMemoryStreamEventManager(),
 *   queueService: null, // 禁用队列，使用 executeSync
 * });
 * ```
 */
export class AgentRuntimeService {
  private coordinator: AgentRuntimeCoordinator;
  private streamManager: IStreamEventManager;
  private queueService: QueueService | null;
  private toolExecutionService: ToolExecutionService;
  /**
   * Step 生命周期回调注册表
   * key: operationId, value: callbacks
   */
  private stepCallbacks: Map<string, StepLifecycleCallbacks> = new Map();
  private get baseURL() {
    const baseUrl =
      process.env.AGENT_RUNTIME_BASE_URL || process.env.APP_URL || 'http://localhost:3010';

    return urlJoin(baseUrl, '/api/agent');
  }
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
    this.userId = userId;
    this.messageModel = new MessageModel(db, this.userId);

    // Initialize ToolExecutionService with dependencies
    const pluginGatewayService = new PluginGatewayService();
    const builtinToolsExecutor = new BuiltinToolsExecutor();

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
   * 注册 step 生命周期回调
   * @param operationId - 操作 ID
   * @param callbacks - 回调函数集合
   */
  registerStepCallbacks(operationId: string, callbacks: StepLifecycleCallbacks): void {
    this.stepCallbacks.set(operationId, callbacks);
    log('[%s] Registered step callbacks', operationId);
  }

  /**
   * 移除 step 生命周期回调
   * @param operationId - 操作 ID
   */
  unregisterStepCallbacks(operationId: string): void {
    this.stepCallbacks.delete(operationId);
    log('[%s] Unregistered step callbacks', operationId);
  }

  /**
   * 获取 step 生命周期回调
   * @param operationId - 操作 ID
   */
  getStepCallbacks(operationId: string): StepLifecycleCallbacks | undefined {
    return this.stepCallbacks.get(operationId);
  }

  // ==================== Operation Management ====================

  /**
   * 创建新的 Agent 操作
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
      stepCallbacks,
    } = params;

    try {
      log('[%s] Creating new operation (autoStart: %s)', operationId, autoStart);

      // 初始化操作状态 - 先创建状态再保存
      const initialState = {
        createdAt: new Date().toISOString(),
        // Store initialContext for executeSync to use
        initialContext,
        lastModified: new Date().toISOString(),
        // 使用传入的初始消息
        messages: initialMessages,
        metadata: {
          agentConfig,
          // need be removed
          modelRuntimeConfig,
          userId,
          ...appContext,
        },
        // modelRuntimeConfig at state level for executor fallback
        modelRuntimeConfig,
        operationId,
        status: 'idle',
        stepCount: 0,
        toolManifestMap,
        tools,
      } as Partial<AgentState>;

      // 使用协调器创建操作，自动发送初始化事件
      await this.coordinator.createAgentOperation(operationId, {
        agentConfig,
        modelRuntimeConfig,
        userId,
      });

      // 保存初始状态
      await this.coordinator.saveAgentState(operationId, initialState as any);

      // 注册 step 生命周期回调
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
          delay: 50, // 短延迟启动
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
   * 执行 Agent 步骤
   */
  async executeStep(params: AgentExecutionParams): Promise<AgentExecutionResult> {
    const { operationId, stepIndex, context, humanInput, approvedToolCall, rejectionReason } =
      params;

    // 获取已注册的回调
    const callbacks = this.getStepCallbacks(operationId);

    try {
      log('[%s] Executing step %d', operationId, stepIndex);

      // 发布步骤开始事件
      await this.streamManager.publishStreamEvent(operationId, {
        data: {},
        stepIndex,
        type: 'step_start',
      });

      // 获取操作状态和元数据
      const [agentState, operationMetadata] = await Promise.all([
        this.coordinator.loadAgentState(operationId),
        this.coordinator.getOperationMetadata(operationId),
      ]);

      if (!agentState) {
        throw new Error(`Agent state not found for operation ${operationId}`);
      }

      // 调用 onBeforeStep 回调
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

      // 创建 Agent 和 Runtime 实例
      const { runtime } = await this.createAgentRuntime({
        metadata: operationMetadata,
        operationId,
        stepIndex,
      });

      // 处理人工干预
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

      // 执行步骤
      const startAt = Date.now();
      const stepResult = await runtime.step(currentState, currentContext);

      // 保存状态，协调器会自动处理事件发送
      await this.coordinator.saveStepResult(operationId, {
        ...stepResult,
        executionTime: Date.now() - startAt,
        stepIndex, // placeholder
      });

      // 决定是否调度下一步
      const shouldContinue = this.shouldContinueExecution(
        stepResult.newState,
        stepResult.nextContext,
      );
      let nextStepScheduled = false;

      // 发布步骤完成事件
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

      // 调用 onAfterStep 回调
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

      // 检查是否操作完成，调用 onComplete 回调
      if (!shouldContinue && callbacks?.onComplete) {
        const reason = this.determineCompletionReason(stepResult.newState);
        try {
          await callbacks.onComplete({
            finalState: stepResult.newState,
            operationId,
            reason,
          });
          // 操作完成后清理回调
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

      // 发布错误事件
      await this.streamManager.publishStreamEvent(operationId, {
        data: {
          error: (error as Error).message,
          phase: 'step_execution',
          stepIndex,
        },
        stepIndex,
        type: 'error',
      });

      // 执行失败时也调用 onComplete 回调
      if (callbacks?.onComplete) {
        try {
          const errorState = await this.coordinator.loadAgentState(operationId);
          await callbacks.onComplete({
            finalState: errorState!,
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
   * 获取操作状态
   */
  async getOperationStatus(params: {
    historyLimit?: number;
    includeHistory?: boolean;
    operationId: string;
  }): Promise<OperationStatusResult | null> {
    const { operationId, includeHistory = false, historyLimit = 10 } = params;

    try {
      log('Getting operation status for %s', operationId);

      // 获取当前状态和元数据
      const [currentState, operationMetadata] = await Promise.all([
        this.coordinator.loadAgentState(operationId),
        this.coordinator.getOperationMetadata(operationId),
      ]);

      // Operation 可能已过期或不存在，返回 null
      if (!currentState || !operationMetadata) {
        log('Operation %s not found (may have expired)', operationId);
        return null;
      }

      // 获取执行历史（如果需要）
      let executionHistory;
      if (includeHistory) {
        try {
          executionHistory = await this.coordinator.getExecutionHistory(operationId, historyLimit);
        } catch (error) {
          log('Failed to load execution history: %O', error);
          executionHistory = [];
        }
      }

      // 获取最近的流式事件（用于调试）
      let recentEvents;
      if (includeHistory) {
        try {
          recentEvents = await this.streamManager.getStreamHistory(operationId, 20);
        } catch (error) {
          log('Failed to load recent events: %O', error);
          recentEvents = [];
        }
      }

      // 计算操作统计信息
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
   * 获取待处理的人工干预列表
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
        // 获取用户的所有活跃操作
        try {
          const activeOperations = await this.coordinator.getActiveOperations();

          // 过滤出属于该用户的操作
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

      // 检查每个操作的状态
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

            // 添加具体的待处理内容
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
   * 显式启动操作执行
   */
  async startExecution(params: StartExecutionParams): Promise<StartExecutionResult> {
    const { operationId, context, priority = 'normal', delay = 50 } = params;

    try {
      log('Starting execution for operation %s', operationId);

      // 检查操作是否存在
      const operationMetadata = await this.coordinator.getOperationMetadata(operationId);
      if (!operationMetadata) {
        throw new Error(`Operation ${operationId} not found`);
      }

      // 获取当前状态
      const currentState = await this.coordinator.loadAgentState(operationId);
      if (!currentState) {
        throw new Error(`Agent state not found for operation ${operationId}`);
      }

      // 检查操作状态
      if (currentState.status === 'running') {
        throw new Error(`Operation ${operationId} is already running`);
      }

      if (currentState.status === 'done') {
        throw new Error(`Operation ${operationId} is already completed`);
      }

      if (currentState.status === 'error') {
        throw new Error(`Operation ${operationId} is in error state`);
      }

      // 构建执行上下文
      let executionContext = context;
      if (!executionContext) {
        // 如果没有提供上下文，从元数据构建默认上下文
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

      // 更新操作状态为运行中
      await this.coordinator.saveAgentState(operationId, {
        ...currentState,
        lastModified: new Date().toISOString(),
        status: 'running',
      });

      // 调度执行（如果队列服务可用）
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
   * 处理人工干预
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

      // 高优先级调度执行（如果队列服务可用）
      let messageId: string | undefined;
      if (this.queueService) {
        messageId = await this.queueService.scheduleMessage({
          context: undefined, // 会从状态管理器中获取
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
   * 创建 Agent Runtime 实例
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
    // 创建 Durable Agent 实例
    const agent = new GeneralChatAgent({
      agentConfig: metadata?.agentConfig,
      modelRuntimeConfig: metadata?.modelRuntimeConfig,
      operationId,
      userId: metadata?.userId,
    });

    // 创建流式执行器上下文
    const executorContext: RuntimeExecutorContext = {
      messageModel: this.messageModel,
      operationId,
      stepIndex,
      streamManager: this.streamManager,
      toolExecutionService: this.toolExecutionService,
      userId: metadata?.userId,
    };

    // 创建 Agent Runtime 实例
    const runtime = new AgentRuntime(agent as any, {
      executors: createRuntimeExecutors(executorContext),
    });

    return { agent, runtime };
  }

  /**
   * 处理人工干预逻辑
   */
  private async handleHumanIntervention(
    runtime: AgentRuntime,
    state: any,
    intervention: { approvedToolCall?: any; humanInput?: any; rejectionReason?: string },
  ) {
    const { humanInput, approvedToolCall, rejectionReason } = intervention;

    if (approvedToolCall && state.status === 'waiting_for_human') {
      // TODO: 实现 approveToolCall 逻辑
      return { newState: state, nextContext: undefined };
    } else if (rejectionReason && state.status === 'waiting_for_human') {
      // TODO: 实现 rejectToolCall 逻辑
      return { newState: state, nextContext: undefined };
    } else if (humanInput) {
      // TODO: 实现 processHumanInput 逻辑
      return { newState: state, nextContext: undefined };
    }

    return { newState: state, nextContext: undefined };
  }

  /**
   * 决定是否继续执行
   */
  private shouldContinueExecution(state: any, context?: any): boolean {
    // 已完成
    if (state.status === 'done') return false;

    // 需要人工干预
    if (state.status === 'waiting_for_human') return false;

    // 出错了
    if (state.status === 'error') return false;

    // 被中断
    if (state.status === 'interrupted') return false;

    // 达到最大步数
    if (state.maxSteps && state.stepCount >= state.maxSteps) return false;

    // 超过成本限制
    if (state.costLimit && state.cost?.total >= state.costLimit.maxTotalCost) {
      return state.costLimit.onExceeded !== 'stop';
    }

    // 没有下一个上下文
    if (!context) return false;

    return true;
  }

  /**
   * 计算步骤延迟
   */
  private calculateStepDelay(stepResult: any): number {
    const baseDelay = 50;

    // 如果有工具调用，延迟长一点
    if (stepResult.events?.some((e: any) => e.type === 'tool_result')) {
      return baseDelay + 50;
    }

    // 如果有错误，使用指数退避
    if (stepResult.events?.some((e: any) => e.type === 'error')) {
      return Math.min(baseDelay * 2, 1000);
    }

    return baseDelay;
  }

  /**
   * 计算优先级
   */
  private calculatePriority(stepResult: any): 'high' | 'normal' | 'low' {
    // 如果需要人工干预，高优先级
    if (stepResult.newState?.status === 'waiting_for_human') {
      return 'high';
    }

    // 如果有错误，正常优先级
    if (stepResult.events?.some((e: any) => e.type === 'error')) {
      return 'normal';
    }

    return 'normal';
  }

  /**
   * 确定操作完成原因
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
   * 同步执行 Agent 操作直到完成
   *
   * 用于测试场景，不依赖 QueueService，直接在当前进程中执行所有步骤。
   *
   * @param operationId 操作 ID
   * @param options 执行选项
   * @returns 最终状态
   *
   * @example
   * ```ts
   * // 创建操作（不自动启动队列）
   * const result = await service.createOperation({ ...params, autoStart: false });
   *
   * // 同步执行到完成
   * const finalState = await service.executeSync(result.operationId);
   * expect(finalState.status).toBe('done');
   * ```
   */
  async executeSync(
    operationId: string,
    options?: {
      /** 初始上下文（如果不提供，从状态中推断） */
      initialContext?: AgentRuntimeContext;
      /** 最大步数限制，防止无限循环，默认 9999 */
      maxSteps?: number;
      /** 每步执行后的回调（用于调试） */
      onStepComplete?: (stepIndex: number, state: AgentState) => void;
    },
  ): Promise<AgentState> {
    const { maxSteps = 9999, onStepComplete, initialContext } = options ?? {};

    log('[%s] Starting sync execution (maxSteps: %d)', operationId, maxSteps);

    // 加载初始状态
    const initialState = await this.coordinator.loadAgentState(operationId);
    if (!initialState) {
      throw new Error(`Agent state not found for operation ${operationId}`);
    }

    let state: AgentState = initialState;

    // 构建初始上下文
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

    // 执行循环
    while (stepIndex < maxSteps) {
      // 检查终止条件
      if (state.status === 'done' || state.status === 'error' || state.status === 'interrupted') {
        log('[%s] Sync execution finished with status: %s', operationId, state.status);
        break;
      }

      // 检查是否需要人工干预
      if (state.status === 'waiting_for_human') {
        log('[%s] Sync execution paused: waiting for human intervention', operationId);
        break;
      }

      // 执行一步
      log('[%s] Executing step %d', operationId, stepIndex);
      const result = await this.executeStep({
        context,
        operationId,
        stepIndex,
      });

      state = result.state as AgentState;
      context = result.stepResult.nextContext;
      stepIndex++;

      // 回调
      if (onStepComplete) {
        onStepComplete(stepIndex, state);
      }

      // 检查是否应该继续
      if (!this.shouldContinueExecution(state, context)) {
        log('[%s] Sync execution stopped: shouldContinue=false', operationId);
        break;
      }
    }

    if (stepIndex >= maxSteps) {
      log('[%s] Sync execution stopped: reached maxSteps (%d)', operationId, maxSteps);
      // 如果因为 executeSync 的 maxSteps 限制停止，需要手动调用 onComplete
      // 注意：如果是因为 state.maxSteps 达到，onComplete 已经在 executeStep 中被调用
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
   * 获取 Coordinator 实例（用于测试）
   */
  getCoordinator(): AgentRuntimeCoordinator {
    return this.coordinator;
  }
}
