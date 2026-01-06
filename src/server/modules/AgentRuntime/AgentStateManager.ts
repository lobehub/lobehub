import { type AgentEvent, type AgentRuntimeContext, type AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';
import type { Redis } from 'ioredis';

import { getAgentRuntimeRedisClient } from './redis';

const log = debug('lobe-server:agent-runtime:agent-state-manager');

export interface StepResult {
  events?: AgentEvent[];
  executionTime: number;
  newState: AgentState;
  nextContext?: AgentRuntimeContext;
  stepIndex: number;
}

export interface AgentOperationMetadata {
  agentConfig?: any;
  createdAt: string;
  lastActiveAt: string;
  modelRuntimeConfig?: any;
  status: AgentState['status'];
  totalCost: number;
  totalSteps: number;
  userId?: string;
}

export class AgentStateManager {
  private redis: Redis;
  private readonly STATE_PREFIX = 'agent_runtime_state';
  private readonly STEPS_PREFIX = 'agent_runtime_steps';
  private readonly METADATA_PREFIX = 'agent_runtime_meta';
  private readonly EVENTS_PREFIX = 'agent_runtime_events';
  private readonly DEFAULT_TTL = 2 * 3600; // 2h

  constructor() {
    const redisClient = getAgentRuntimeRedisClient();
    if (!redisClient) {
      throw new Error('Redis is not available. Please configure REDIS_URL environment variable.');
    }
    this.redis = redisClient;
  }

  /**
   * 保存 Agent 状态
   */
  async saveAgentState(operationId: string, state: AgentState): Promise<void> {
    const stateKey = `${this.STATE_PREFIX}:${operationId}`;

    try {
      const serializedState = JSON.stringify(state);
      await this.redis.setex(stateKey, this.DEFAULT_TTL, serializedState);

      // 更新元数据
      await this.updateOperationMetadata(operationId, {
        lastActiveAt: new Date().toISOString(),
        status: state.status,
        totalCost: state.cost?.total || 0,
        totalSteps: state.stepCount,
      });

      // 状态变更事件通过 saveStepResult 中的 events 数组记录

      log('[%s] Saved state for step %d', operationId, state.stepCount);
    } catch (error) {
      console.error('Failed to save agent state:', error);
      throw error;
    }
  }

  /**
   * 加载 Agent 状态
   */
  async loadAgentState(operationId: string): Promise<AgentState | null> {
    const stateKey = `${this.STATE_PREFIX}:${operationId}`;

    try {
      const serializedState = await this.redis.get(stateKey);

      if (!serializedState) {
        return null;
      }

      const state = JSON.parse(serializedState) as AgentState;
      log('[%s] Loaded state (step %d)', operationId, state.stepCount);

      return state;
    } catch (error) {
      console.error('Failed to load agent state:', error);
      throw error;
    }
  }

  /**
   * 保存步骤执行结果
   */
  async saveStepResult(operationId: string, stepResult: StepResult): Promise<void> {
    const pipeline = this.redis.multi();

    try {
      // 保存最新状态
      const stateKey = `${this.STATE_PREFIX}:${operationId}`;
      pipeline.setex(stateKey, this.DEFAULT_TTL, JSON.stringify(stepResult.newState));

      // 保存步骤历史
      const stepsKey = `${this.STEPS_PREFIX}:${operationId}`;
      const stepData = {
        context: stepResult.nextContext,
        cost: stepResult.newState.cost?.total || 0,
        executionTime: stepResult.executionTime,
        status: stepResult.newState.status,
        stepIndex: stepResult.stepIndex,
        timestamp: Date.now(),
      };

      pipeline.lpush(stepsKey, JSON.stringify(stepData));
      pipeline.ltrim(stepsKey, 0, 199); // 保留最近 200 步
      pipeline.expire(stepsKey, this.DEFAULT_TTL);

      // 保存步骤的事件序列到 agent_runtime_events
      if (stepResult.events && stepResult.events.length > 0) {
        const eventsKey = `${this.EVENTS_PREFIX}:${operationId}`;

        pipeline.lpush(eventsKey, JSON.stringify(stepResult.events));
        pipeline.ltrim(eventsKey, 0, 199); // 保留最近 200 步的事件
        pipeline.expire(eventsKey, this.DEFAULT_TTL);
      }

      // 更新操作元数据
      const metaKey = `${this.METADATA_PREFIX}:${operationId}`;
      const metadata: Partial<AgentOperationMetadata> = {
        lastActiveAt: new Date().toISOString(),
        status: stepResult.newState.status,
        totalCost: stepResult.newState.cost?.total || 0,
        totalSteps: stepResult.newState.stepCount,
      };
      pipeline.hmset(metaKey, metadata as any);
      pipeline.expire(metaKey, this.DEFAULT_TTL);

      await pipeline.exec();

      log(
        '[%s:%d] Saved step result with %d events',
        operationId,
        stepResult.stepIndex,
        stepResult.events?.length || 0,
      );
    } catch (error) {
      console.error('Failed to save step result:', error);
      throw error;
    }
  }

  /**
   * 获取执行历史
   */
  async getExecutionHistory(operationId: string, limit: number = 50): Promise<any[]> {
    const stepsKey = `${this.STEPS_PREFIX}:${operationId}`;

    try {
      const history = await this.redis.lrange(stepsKey, 0, limit - 1);
      return history.map((item) => JSON.parse(item)).reverse(); // 最早的在前面
    } catch (error) {
      console.error('Failed to get execution history:', error);
      return [];
    }
  }

  /**
   * 获取操作元数据
   */
  async getOperationMetadata(operationId: string): Promise<AgentOperationMetadata | null> {
    const metaKey = `${this.METADATA_PREFIX}:${operationId}`;

    try {
      const metadata = await this.redis.hgetall(metaKey);

      if (Object.keys(metadata).length === 0) {
        return null;
      }

      return {
        agentConfig: metadata.agentConfig ? JSON.parse(metadata.agentConfig) : undefined,
        createdAt: metadata.createdAt,
        lastActiveAt: metadata.lastActiveAt,
        modelRuntimeConfig: metadata.modelRuntimeConfig
          ? JSON.parse(metadata.modelRuntimeConfig)
          : undefined,
        status: metadata.status as AgentState['status'],
        totalCost: parseFloat(metadata.totalCost) || 0,
        totalSteps: parseInt(metadata.totalSteps) || 0,
        userId: metadata.userId,
      };
    } catch (error) {
      console.error('Failed to get operation metadata:', error);
      return null;
    }
  }

  /**
   * 创建新的操作元数据
   */
  async createOperationMetadata(
    operationId: string,
    data: {
      agentConfig?: any;
      modelRuntimeConfig?: any;
      userId?: string;
    },
  ): Promise<void> {
    const metaKey = `${this.METADATA_PREFIX}:${operationId}`;

    try {
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

      // 序列化复杂对象
      const redisData: Record<string, string> = {
        createdAt: metadata.createdAt,
        lastActiveAt: metadata.lastActiveAt,
        status: metadata.status,
        totalCost: metadata.totalCost.toString(),
        totalSteps: metadata.totalSteps.toString(),
      };

      if (metadata.userId) redisData.userId = metadata.userId;
      if (metadata.modelRuntimeConfig)
        redisData.modelRuntimeConfig = JSON.stringify(metadata.modelRuntimeConfig);
      if (metadata.agentConfig) redisData.agentConfig = JSON.stringify(metadata.agentConfig);

      await this.redis.hmset(metaKey, redisData);
      await this.redis.expire(metaKey, this.DEFAULT_TTL);

      log('[%s] Created operation metadata', operationId);
    } catch (error) {
      console.error('Failed to create operation metadata:', error);
      throw error;
    }
  }

  /**
   * 更新操作元数据
   */
  private async updateOperationMetadata(
    operationId: string,
    updates: Partial<AgentOperationMetadata>,
  ): Promise<void> {
    const metaKey = `${this.METADATA_PREFIX}:${operationId}`;

    try {
      const redisUpdates: Record<string, string> = {};

      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined) {
          if (typeof value === 'object') {
            redisUpdates[key] = JSON.stringify(value);
          } else {
            redisUpdates[key] = value.toString();
          }
        }
      });

      if (Object.keys(redisUpdates).length > 0) {
        await this.redis.hmset(metaKey, redisUpdates);
        await this.redis.expire(metaKey, this.DEFAULT_TTL);
      }
    } catch (error) {
      console.error('Failed to update session metadata:', error);
    }
  }

  /**
   * 删除 Agent 操作的所有数据
   */
  async deleteAgentOperation(operationId: string): Promise<void> {
    const keys = [
      `${this.STATE_PREFIX}:${operationId}`,
      `${this.STEPS_PREFIX}:${operationId}`,
      `${this.METADATA_PREFIX}:${operationId}`,
      `${this.EVENTS_PREFIX}:${operationId}`,
    ];

    try {
      await this.redis.del(...keys);
      log('Deleted operation %s', operationId);
    } catch (error) {
      console.error('Failed to delete agent operation:', error);
      throw error;
    }
  }

  /**
   * 获取所有活跃操作
   */
  async getActiveOperations(): Promise<string[]> {
    try {
      const pattern = `${this.STATE_PREFIX}:*`;
      const keys = await this.redis.keys(pattern);
      return keys.map((key) => key.replace(`${this.STATE_PREFIX}:`, ''));
    } catch (error) {
      console.error('Failed to get active operations:', error);
      return [];
    }
  }

  /**
   * 清理过期的操作数据
   */
  async cleanupExpiredOperations(): Promise<number> {
    try {
      const activeOperations = await this.getActiveOperations();
      let cleanedCount = 0;

      for (const operationId of activeOperations) {
        const metadata = await this.getOperationMetadata(operationId);

        if (metadata) {
          const lastActiveTime = new Date(metadata.lastActiveAt).getTime();
          const now = Date.now();
          const hoursSinceActive = (now - lastActiveTime) / (1000 * 60 * 60);

          // 清理超过 2 小时未活跃的操作
          if (hoursSinceActive > 2) {
            await this.deleteAgentOperation(operationId);
            cleanedCount++;
          }
        }
      }

      log('Cleaned up %d expired operations', cleanedCount);
      return cleanedCount;
    } catch (error) {
      console.error('Failed to cleanup expired operations:', error);
      return 0;
    }
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
    try {
      const operations = await this.getActiveOperations();
      const stats = {
        activeOperations: 0,
        completedOperations: 0,
        errorOperations: 0,
        totalOperations: operations.length,
      };

      for (const operationId of operations) {
        const metadata = await this.getOperationMetadata(operationId);

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
    } catch (error) {
      console.error('Failed to get stats:', error);
      return {
        activeOperations: 0,
        completedOperations: 0,
        errorOperations: 0,
        totalOperations: 0,
      };
    }
  }

  /**
   * 关闭 Redis 连接
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
