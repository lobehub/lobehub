import { type AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import { type AgentOperationMetadata, type StepResult } from './AgentStateManager';
import { createAgentStateManager, createStreamEventManager } from './factory';
import type { IAgentStateManager, IStreamEventManager } from './types';

const log = debug('lobe-server:agent-runtime:coordinator');

export interface AgentRuntimeCoordinatorOptions {
  /**
   * 自定义状态管理器实现
   * 默认根据 Redis 可用性自动选择实现
   */
  stateManager?: IAgentStateManager;
  /**
   * 自定义流式事件管理器实现
   * 默认根据 Redis 可用性自动选择实现
   */
  streamEventManager?: IStreamEventManager;
}

/**
 * Agent Runtime Coordinator
 * 协调 AgentStateManager 和 StreamEventManager 的操作
 * 负责在状态变更时发送相应的事件
 *
 * 默认行为：
 * - Redis 可用时使用 Redis 实现
 * - Redis 不可用时自动回退到内存实现（本地开发模式）
 *
 * 支持依赖注入，可以传入自定义实现
 */
export class AgentRuntimeCoordinator {
  private stateManager: IAgentStateManager;
  private streamEventManager: IStreamEventManager;

  constructor(options?: AgentRuntimeCoordinatorOptions) {
    this.stateManager = options?.stateManager ?? createAgentStateManager();
    this.streamEventManager = options?.streamEventManager ?? createStreamEventManager();
  }

  /**
   * 创建新的 Agent 操作并发送初始化事件
   */
  async createAgentOperation(
    operationId: string,
    data: {
      agentConfig?: any;
      modelRuntimeConfig?: any;
      userId?: string;
    },
  ): Promise<void> {
    try {
      // 创建操作元数据
      await this.stateManager.createOperationMetadata(operationId, data);

      // 获取创建的元数据
      const metadata = await this.stateManager.getOperationMetadata(operationId);

      if (metadata) {
        // 发送 agent runtime init 事件
        await this.streamEventManager.publishAgentRuntimeInit(operationId, metadata);
        log('[%s] Agent operation created and initialized', operationId);
      }
    } catch (error) {
      console.error('Failed to create agent operation:', error);
      throw error;
    }
  }

  /**
   * 保存 Agent 状态并处理相应事件
   */
  async saveAgentState(operationId: string, state: AgentState): Promise<void> {
    try {
      const previousState = await this.stateManager.loadAgentState(operationId);

      // 保存状态
      await this.stateManager.saveAgentState(operationId, state);

      // 如果状态变为 done，发送 agent runtime end 事件
      if (state.status === 'done' && previousState?.status !== 'done') {
        await this.streamEventManager.publishAgentRuntimeEnd(operationId, state.stepCount, state);
        log('[%s] Agent runtime completed', operationId);
      }
    } catch (error) {
      console.error('Failed to save agent state and handle events:', error);
      throw error;
    }
  }

  /**
   * 保存步骤结果并处理相应事件
   */
  async saveStepResult(operationId: string, stepResult: StepResult): Promise<void> {
    try {
      // 获取之前的状态用于检测状态变化
      const previousState = await this.stateManager.loadAgentState(operationId);

      // 保存步骤结果
      await this.stateManager.saveStepResult(operationId, stepResult);

      // 如果状态变为 done，发送 agent_runtime_end 事件
      // 这确保 agent_runtime_end 在所有步骤事件之后发送
      if (stepResult.newState.status === 'done' && previousState?.status !== 'done') {
        await this.streamEventManager.publishAgentRuntimeEnd(
          operationId,
          stepResult.newState.stepCount,
          stepResult.newState,
        );
        log('[%s] Agent runtime completed', operationId);
      }
    } catch (error) {
      console.error('Failed to save step result and handle events:', error);
      throw error;
    }
  }

  /**
   * 获取 Agent 状态
   */
  async loadAgentState(operationId: string): Promise<AgentState | null> {
    return this.stateManager.loadAgentState(operationId);
  }

  /**
   * 获取操作元数据
   */
  async getOperationMetadata(operationId: string): Promise<AgentOperationMetadata | null> {
    return this.stateManager.getOperationMetadata(operationId);
  }

  /**
   * 获取执行历史
   */
  async getExecutionHistory(operationId: string, limit?: number): Promise<any[]> {
    return this.stateManager.getExecutionHistory(operationId, limit);
  }

  /**
   * 删除 Agent 操作
   */
  async deleteAgentOperation(operationId: string): Promise<void> {
    try {
      await Promise.all([
        this.stateManager.deleteAgentOperation(operationId),
        this.streamEventManager.cleanupOperation(operationId),
      ]);
      log('Agent operation deleted: %s', operationId);
    } catch (error) {
      console.error('Failed to delete agent operation:', error);
      throw error;
    }
  }

  /**
   * 获取活跃操作
   */
  async getActiveOperations(): Promise<string[]> {
    return this.stateManager.getActiveOperations();
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    activeOperations: number;
    completedOperations: number;
    errorOperations: number;
    totalOperations: number;
  }> {
    return this.stateManager.getStats();
  }

  /**
   * 清理过期操作
   */
  async cleanupExpiredOperations(): Promise<number> {
    return this.stateManager.cleanupExpiredOperations();
  }

  /**
   * 关闭连接
   */
  async disconnect(): Promise<void> {
    await Promise.all([this.stateManager.disconnect(), this.streamEventManager.disconnect()]);
  }
}
