import type { AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import type { AgentOperationMetadata, StepResult } from './AgentStateManager';
import type { IAgentStateManager } from './types';

const log = debug('lobe-server:agent-runtime:in-memory-state-manager');

/**
 * In-Memory Agent State Manager
 * 内存实现，用于测试和本地开发环境
 */
export class InMemoryAgentStateManager implements IAgentStateManager {
  private states: Map<string, AgentState> = new Map();
  private steps: Map<string, any[]> = new Map();
  private metadata: Map<string, AgentOperationMetadata> = new Map();
  private events: Map<string, any[][]> = new Map();

  async saveAgentState(operationId: string, state: AgentState): Promise<void> {
    // 深拷贝以避免引用问题
    this.states.set(operationId, structuredClone(state));

    // 更新元数据
    const existingMeta = this.metadata.get(operationId);
    if (existingMeta) {
      existingMeta.lastActiveAt = new Date().toISOString();
      existingMeta.status = state.status;
      existingMeta.totalCost = state.cost?.total || 0;
      existingMeta.totalSteps = state.stepCount;
    }

    log('[%s] Saved state for step %d', operationId, state.stepCount);
  }

  async loadAgentState(operationId: string): Promise<AgentState | null> {
    const state = this.states.get(operationId);
    if (!state) {
      return null;
    }

    log('[%s] Loaded state (step %d)', operationId, state.stepCount);
    // 返回深拷贝以避免外部修改影响内部状态
    return structuredClone(state);
  }

  async saveStepResult(operationId: string, stepResult: StepResult): Promise<void> {
    // 保存最新状态
    this.states.set(operationId, structuredClone(stepResult.newState));

    // 保存步骤历史
    let stepHistory = this.steps.get(operationId);
    if (!stepHistory) {
      stepHistory = [];
      this.steps.set(operationId, stepHistory);
    }

    const stepData = {
      context: stepResult.nextContext,
      cost: stepResult.newState.cost?.total || 0,
      executionTime: stepResult.executionTime,
      status: stepResult.newState.status,
      stepIndex: stepResult.stepIndex,
      timestamp: Date.now(),
    };

    // 在开头插入（最新的在前面）
    stepHistory.unshift(stepData);
    // 保留最近 200 步
    if (stepHistory.length > 200) {
      stepHistory.length = 200;
    }

    // 保存步骤的事件序列
    if (stepResult.events && stepResult.events.length > 0) {
      let eventHistory = this.events.get(operationId);
      if (!eventHistory) {
        eventHistory = [];
        this.events.set(operationId, eventHistory);
      }
      eventHistory.unshift(stepResult.events);
      if (eventHistory.length > 200) {
        eventHistory.length = 200;
      }
    }

    // 更新操作元数据
    const existingMeta = this.metadata.get(operationId);
    if (existingMeta) {
      existingMeta.lastActiveAt = new Date().toISOString();
      existingMeta.status = stepResult.newState.status;
      existingMeta.totalCost = stepResult.newState.cost?.total || 0;
      existingMeta.totalSteps = stepResult.newState.stepCount;
    }

    log(
      '[%s:%d] Saved step result with %d events',
      operationId,
      stepResult.stepIndex,
      stepResult.events?.length || 0,
    );
  }

  async getExecutionHistory(operationId: string, limit: number = 50): Promise<any[]> {
    const history = this.steps.get(operationId);
    if (!history) {
      return [];
    }

    // 返回反转后的数组（最早的在前面）
    return history.slice(0, limit).reverse();
  }

  async getOperationMetadata(operationId: string): Promise<AgentOperationMetadata | null> {
    return this.metadata.get(operationId) ?? null;
  }

  async createOperationMetadata(
    operationId: string,
    data: {
      agentConfig?: any;
      modelRuntimeConfig?: any;
      userId?: string;
    },
  ): Promise<void> {
    const metadata: AgentOperationMetadata = {
      agentConfig: data.agentConfig,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      modelRuntimeConfig: data.modelRuntimeConfig,
      status: 'idle',
      totalCost: 0,
      totalSteps: 0,
      userId: data.userId,
    };

    this.metadata.set(operationId, metadata);
    log('[%s] Created operation metadata', operationId);
  }

  async deleteAgentOperation(operationId: string): Promise<void> {
    this.states.delete(operationId);
    this.steps.delete(operationId);
    this.metadata.delete(operationId);
    this.events.delete(operationId);
    log('Deleted operation %s', operationId);
  }

  async getActiveOperations(): Promise<string[]> {
    return Array.from(this.states.keys());
  }

  async cleanupExpiredOperations(): Promise<number> {
    const activeOperations = await this.getActiveOperations();
    let cleanedCount = 0;

    for (const operationId of activeOperations) {
      const metadata = this.metadata.get(operationId);

      if (metadata) {
        const lastActiveTime = new Date(metadata.lastActiveAt).getTime();
        const now = Date.now();
        const hoursSinceActive = (now - lastActiveTime) / (1000 * 60 * 60);

        // 清理超过 1 小时未活跃的操作
        if (hoursSinceActive > 1) {
          await this.deleteAgentOperation(operationId);
          cleanedCount++;
        }
      }
    }

    log('Cleaned up %d expired operations', cleanedCount);
    return cleanedCount;
  }

  async getStats(): Promise<{
    activeOperations: number;
    completedOperations: number;
    errorOperations: number;
    totalOperations: number;
  }> {
    const operations = await this.getActiveOperations();
    const stats = {
      activeOperations: 0,
      completedOperations: 0,
      errorOperations: 0,
      totalOperations: operations.length,
    };

    for (const operationId of operations) {
      const metadata = this.metadata.get(operationId);

      if (metadata) {
        switch (metadata.status) {
          case 'running':
          case 'waiting_for_human': {
            stats.activeOperations++;
            break;
          }
          case 'done': {
            stats.completedOperations++;
            break;
          }
          case 'error':
          case 'interrupted': {
            stats.errorOperations++;
            break;
          }
        }
      }
    }

    return stats;
  }

  async disconnect(): Promise<void> {
    // 内存实现无需断开连接
    log('InMemoryAgentStateManager disconnected');
  }

  /**
   * 清空所有数据（用于测试）
   */
  clear(): void {
    this.states.clear();
    this.steps.clear();
    this.metadata.clear();
    this.events.clear();
    log('All data cleared');
  }

  /**
   * 获取事件历史（用于测试验证）
   */
  getEventHistory(operationId: string): any[][] {
    return this.events.get(operationId) ?? [];
  }
}

/**
 * 单例实例，用于测试和本地开发环境
 */
export const inMemoryAgentStateManager = new InMemoryAgentStateManager();
