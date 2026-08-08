import {
  type AgentEvent,
  type AgentRuntimeContext,
  type AgentState,
} from '@lobechat/agent-runtime';
import debug from 'debug';
import { type Redis } from 'ioredis';

import { hasNonPersistedMessage } from './messagePersistence';
import { getAgentRuntimeRedisClient } from './redis';
import { stripFinalStateInEventData } from './StreamEventManager';

const log = debug('lobe-server:agent-runtime:agent-state-manager');

const REFRESH_OWNED_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE_OWNED_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

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
  /**
   * When set, the Gateway stream notifier mirrors this operation's stream events
   * onto the named operation's Gateway channel as well (single-connection
   * multiplexing). Used so a broadcast member's streaming events also flow down
   * the supervisor's existing WebSocket — the supervisor's own operationId —
   * instead of stranding on a member channel nobody subscribes to.
   */
  mirrorToOperationId?: string;
  modelRuntimeConfig?: any;
  status: AgentState['status'];
  totalCost: number;
  totalSteps: number;
  userId?: string;
  /**
   * Workspace the operation runs in (null/undefined = personal). Persisted so
   * queue workers (e.g. QStash `runStep`) can reconstruct a workspace-scoped
   * runtime; without it the runtime is personal-scoped and message/topic
   * lookups miss workspace-scoped rows.
   */
  workspaceId?: string;
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
   * Serialize an AgentState for Redis persistence, dropping the `messages`
   * array first.
   *
   * `messages` is the dominant size driver of the serialized state — long
   * topics inline tool results and base64 media, pushing the blob past
   * Upstash's 10MB single-request limit, which throws and drops the op
   * outright (StateStorePersistError). It is also fully reconstructible: the
   * canonical rows live in the DB and every step rehydrates `state.messages`
   * from there on entry (`AgentRuntimeService.rehydrateStateMessagesFromDB`),
   * while the few out-of-band readers fall back to a DB query. So we never
   * serialize it into the persisted blob.
   *
   * Keep this in sync with the stream-event strip in `StreamEventManager`
   * (`stripStateForStream`) and the `done`-event strip in
   * `OperationTraceRecorder` — all drop the same reconstructible payload.
   *
   * Exception: when the working set carries a non-persisted (ephemeral /
   * suppressed) message — one with no DB row — the array is NOT reconstructible
   * from a query, so persist it in full. These ops are rare and short-lived
   * (group-member supervisor turns); the size win is forgone to avoid losing
   * the prompt.
   */
  private serializeStateForPersist(state: AgentState): string {
    if (hasNonPersistedMessage((state as { messages?: unknown }).messages)) {
      return JSON.stringify(state);
    }
    const { messages: _messages, ...rest } = state as AgentState & { messages?: unknown };
    return JSON.stringify(rest);
  }

  /**
   * Save Agent state
   */
  async saveAgentState(operationId: string, state: AgentState): Promise<void> {
    const stateKey = `${this.STATE_PREFIX}:${operationId}`;

    try {
      const serializedState = this.serializeStateForPersist(state);
      await this.redis.setex(stateKey, this.DEFAULT_TTL, serializedState);

      // Update metadata
      await this.updateOperationMetadata(operationId, {
        lastActiveAt: new Date().toISOString(),
        status: state.status,
        totalCost: state.cost?.total || 0,
        totalSteps: state.stepCount,
      });

      // State change events are recorded through the events array in saveStepResult

      log('[%s] Saved state for step %d', operationId, state.stepCount);
    } catch (error) {
      console.error('Failed to save agent state:', error);
      throw error;
    }
  }

  /**
   * Load Agent state
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
   * Save step execution result
   */
  async saveStepResult(operationId: string, stepResult: StepResult): Promise<void> {
    const pipeline = this.redis.multi();

    try {
      // Save latest state
      const stateKey = `${this.STATE_PREFIX}:${operationId}`;
      pipeline.setex(
        stateKey,
        this.DEFAULT_TTL,
        this.serializeStateForPersist(stepResult.newState),
      );

      // Save step history
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
      pipeline.ltrim(stepsKey, 0, 199); // Keep most recent 200 steps
      pipeline.expire(stepsKey, this.DEFAULT_TTL);

      // Save step event sequence to agent_runtime_events
      if (stepResult.events && stepResult.events.length > 0) {
        const eventsKey = `${this.EVENTS_PREFIX}:${operationId}`;

        // A terminal `done` event carries the full `finalState` (incl. messages
        // + tool-set), so strip those reconstructible fields before persisting —
        // same chokepoint the stream path uses — otherwise this lpush is a
        // second route to Upstash's 10MB limit on long topics.
        pipeline.lpush(
          eventsKey,
          JSON.stringify(stepResult.events.map(stripFinalStateInEventData)),
        );
        pipeline.ltrim(eventsKey, 0, 199); // Keep events from most recent 200 steps
        pipeline.expire(eventsKey, this.DEFAULT_TTL);
      }

      // Update operation metadata
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
   * Get execution history
   */
  async getExecutionHistory(operationId: string, limit: number = 50): Promise<any[]> {
    const stepsKey = `${this.STEPS_PREFIX}:${operationId}`;

    try {
      const history = await this.redis.lrange(stepsKey, 0, limit - 1);
      return history.map((item) => JSON.parse(item)).reverse(); // Earliest first
    } catch (error) {
      console.error('Failed to get execution history:', error);
      return [];
    }
  }

  /**
   * Get operation metadata
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
        mirrorToOperationId: metadata.mirrorToOperationId || undefined,
        status: metadata.status as AgentState['status'],
        totalCost: parseFloat(metadata.totalCost) || 0,
        totalSteps: parseInt(metadata.totalSteps) || 0,
        userId: metadata.userId,
        workspaceId: metadata.workspaceId,
      };
    } catch (error) {
      console.error('Failed to get operation metadata:', error);
      return null;
    }
  }

  /**
   * Create new operation metadata
   */
  async createOperationMetadata(
    operationId: string,
    data: {
      agentConfig?: any;
      mirrorToOperationId?: string;
      modelRuntimeConfig?: any;
      userId?: string;
      workspaceId?: string;
    },
  ): Promise<void> {
    const metaKey = `${this.METADATA_PREFIX}:${operationId}`;

    try {
      const metadata: AgentOperationMetadata = {
        agentConfig: data.agentConfig,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        mirrorToOperationId: data.mirrorToOperationId,
        modelRuntimeConfig: data.modelRuntimeConfig,
        status: 'idle',
        totalCost: 0,
        totalSteps: 0,
        userId: data.userId,
        workspaceId: data.workspaceId,
      };

      // Serialize complex objects
      const redisData: Record<string, string> = {
        createdAt: metadata.createdAt,
        lastActiveAt: metadata.lastActiveAt,
        status: metadata.status,
        totalCost: metadata.totalCost.toString(),
        totalSteps: metadata.totalSteps.toString(),
      };

      if (metadata.userId) redisData.userId = metadata.userId;
      if (metadata.workspaceId) redisData.workspaceId = metadata.workspaceId;
      if (metadata.mirrorToOperationId)
        redisData.mirrorToOperationId = metadata.mirrorToOperationId;
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
   * Update operation metadata
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
   * Delete all data for Agent operation
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
   * Get all active operations
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
   * Clean up expired operation data
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

          // Clean up operations inactive for more than 2 hours
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
   * Get statistics
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

  private executionLockKey(operationId: string): string {
    return `agent_runtime_operation_lock:${operationId}`;
  }

  async tryClaimStep(
    operationId: string,
    _stepIndex: number,
    ttlSeconds: number = 35,
    ownerId: string = Date.now().toString(),
  ): Promise<boolean> {
    try {
      const result = await this.redis.set(
        this.executionLockKey(operationId),
        ownerId,
        'EX',
        ttlSeconds,
        'NX',
      );

      return result === 'OK';
    } catch (error) {
      // Fail-open: on Redis error, allow execution to proceed
      console.error('Failed to acquire step lock:', error);
      return true;
    }
  }

  async refreshStepLock(
    operationId: string,
    _stepIndex: number,
    ttlSeconds: number,
    ownerId?: string,
  ): Promise<boolean> {
    try {
      const key = this.executionLockKey(operationId);
      if (!ownerId) {
        return (await this.redis.expire(key, ttlSeconds)) === 1;
      }

      const result = await this.redis.eval(
        REFRESH_OWNED_LOCK_SCRIPT,
        1,
        key,
        ownerId,
        ttlSeconds.toString(),
      );

      return result === 1;
    } catch (error) {
      console.error('Failed to refresh step lock:', error);
      return false;
    }
  }

  async releaseStepLock(operationId: string, _stepIndex: number, ownerId?: string): Promise<void> {
    try {
      const key = this.executionLockKey(operationId);
      if (!ownerId) {
        await this.redis.del(key);
        return;
      }

      await this.redis.eval(RELEASE_OWNED_LOCK_SCRIPT, 1, key, ownerId);
    } catch (error) {
      console.error('Failed to release step lock:', error);
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
