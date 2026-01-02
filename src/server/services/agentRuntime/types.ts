import { type AgentRuntimeContext, type AgentState } from '@lobechat/agent-runtime';
import { type LobeToolManifest } from '@lobechat/context-engine';

// ==================== Step Lifecycle Callbacks ====================

/**
 * Step 执行生命周期回调
 * 用于在 step 执行的不同阶段注入自定义逻辑
 */
export interface StepLifecycleCallbacks {
  /**
   * 在 step 执行后调用
   */
  onAfterStep?: (params: {
    operationId: string;
    shouldContinue: boolean;
    state: AgentState;
    stepIndex: number;
    stepResult: any;
  }) => Promise<void>;

  /**
   * 在 step 执行前调用
   */
  onBeforeStep?: (params: {
    context?: AgentRuntimeContext;
    operationId: string;
    state: AgentState;
    stepIndex: number;
  }) => Promise<void>;

  /**
   * 在操作完成时调用（status 变为 done/error/interrupted）
   */
  onComplete?: (params: {
    finalState: AgentState;
    operationId: string;
    reason: StepCompletionReason;
  }) => Promise<void>;
}

/**
 * Step 完成原因
 */
export type StepCompletionReason =
  | 'done'
  | 'error'
  | 'interrupted'
  | 'max_steps'
  | 'cost_limit'
  | 'waiting_for_human';

// ==================== Execution Params ====================

export interface AgentExecutionParams {
  approvedToolCall?: any;
  context?: AgentRuntimeContext;
  humanInput?: any;
  operationId: string;
  rejectionReason?: string;
  stepIndex: number;
}

export interface AgentExecutionResult {
  nextStepScheduled: boolean;
  state: any;
  stepResult?: any;
  success: boolean;
}

export interface OperationCreationParams {
  agentConfig?: any;
  appContext: {
    agentId?: string;
    groupId?: string | null;
    threadId?: string | null;
    topicId?: string | null;
  };
  autoStart?: boolean;
  initialContext: AgentRuntimeContext;
  initialMessages?: any[];
  modelRuntimeConfig?: any;
  operationId: string;
  /**
   * Step 生命周期回调
   * 用于在 step 执行的不同阶段注入自定义逻辑
   */
  stepCallbacks?: StepLifecycleCallbacks;
  toolManifestMap: Record<string, LobeToolManifest>;
  tools?: any[];
  userId?: string;
}

export interface OperationCreationResult {
  autoStarted: boolean;
  messageId?: string;
  operationId: string;
  success: boolean;
}

export interface OperationStatusResult {
  currentState: {
    cost?: any;
    costLimit?: any;
    error?: string;
    interruption?: any;
    lastModified: string;
    maxSteps?: number;
    pendingHumanPrompt?: any;
    pendingHumanSelect?: any;
    pendingToolsCalling?: any;
    status: string;
    stepCount: number;
    usage?: any;
  };
  executionHistory?: any[];
  hasError: boolean;
  isActive: boolean;
  isCompleted: boolean;
  metadata: any;
  needsHumanInput: boolean;
  operationId: string;
  recentEvents?: any[];
  stats: {
    lastActiveTime: number;
    totalCost: number;
    totalMessages: number;
    totalSteps: number;
    uptime: number;
  };
}

export interface PendingInterventionsResult {
  pendingInterventions: Array<{
    lastModified: string;
    modelRuntimeConfig?: any;
    operationId: string;
    pendingHumanPrompt?: any;
    pendingHumanSelect?: any;
    pendingToolsCalling?: any[];
    status: string;
    stepCount: number;
    type: 'tool_approval' | 'human_prompt' | 'human_select';
    userId?: string;
  }>;
  timestamp: string;
  totalCount: number;
}

export interface StartExecutionParams {
  context?: AgentRuntimeContext;
  delay?: number;
  operationId: string;
  priority?: 'high' | 'normal' | 'low';
}

export interface StartExecutionResult {
  messageId?: string;
  operationId: string;
  scheduled: boolean;
  success: boolean;
}
