import type { AgentState } from '@lobechat/agent-runtime';

import type { AgentOperationMetadata, StepResult } from './AgentStateManager';
import type { StreamChunkData, StreamEvent } from './StreamEventManager';

/**
 * Agent State Manager Interface
 * 用于状态持久化的抽象接口，支持 Redis 和内存实现
 */
export interface IAgentStateManager {
  /**
   * 清理过期的操作数据
   */
  cleanupExpiredOperations(): Promise<number>;

  /**
   * 创建新的操作元数据
   */
  createOperationMetadata(
    operationId: string,
    data: {
      agentConfig?: any;
      modelRuntimeConfig?: any;
      userId?: string;
    },
  ): Promise<void>;

  /**
   * 删除 Agent 操作的所有数据
   */
  deleteAgentOperation(operationId: string): Promise<void>;

  /**
   * 关闭连接
   */
  disconnect(): Promise<void>;

  /**
   * 获取所有活跃操作
   */
  getActiveOperations(): Promise<string[]>;

  /**
   * 获取执行历史
   */
  getExecutionHistory(operationId: string, limit?: number): Promise<any[]>;

  /**
   * 获取操作元数据
   */
  getOperationMetadata(operationId: string): Promise<AgentOperationMetadata | null>;

  /**
   * 获取统计信息
   */
  getStats(): Promise<{
    activeOperations: number;
    completedOperations: number;
    errorOperations: number;
    totalOperations: number;
  }>;

  /**
   * 加载 Agent 状态
   */
  loadAgentState(operationId: string): Promise<AgentState | null>;

  /**
   * 保存 Agent 状态
   */
  saveAgentState(operationId: string, state: AgentState): Promise<void>;

  /**
   * 保存步骤执行结果
   */
  saveStepResult(operationId: string, stepResult: StepResult): Promise<void>;
}

/**
 * Stream Event Manager Interface
 * 用于流式事件发布的抽象接口，支持 Redis 和内存实现
 */
export interface IStreamEventManager {
  /**
   * 清理操作的流式数据
   */
  cleanupOperation(operationId: string): Promise<void>;

  /**
   * 关闭连接
   */
  disconnect(): Promise<void>;

  /**
   * 获取活跃操作数量
   */
  getActiveOperationsCount(): Promise<number>;

  /**
   * 获取流式事件历史
   */
  getStreamHistory(operationId: string, count?: number): Promise<StreamEvent[]>;

  /**
   * 发布 Agent 运行时结束事件
   */
  publishAgentRuntimeEnd(
    operationId: string,
    stepIndex: number,
    finalState: any,
    reason?: string,
    reasonDetail?: string,
  ): Promise<string>;

  /**
   * 发布 Agent 运行时初始化事件
   */
  publishAgentRuntimeInit(operationId: string, initialState: any): Promise<string>;

  /**
   * 发布流式内容块
   */
  publishStreamChunk(
    operationId: string,
    stepIndex: number,
    chunkData: StreamChunkData,
  ): Promise<string>;

  /**
   * 发布流式事件
   */
  publishStreamEvent(
    operationId: string,
    event: Omit<StreamEvent, 'operationId' | 'timestamp'>,
  ): Promise<string>;
}
