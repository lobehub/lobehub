import {
  type AgentEvent,
  type AgentRuntimeContext,
  type AgentState,
  getLlmCallCount,
  normalizeAgentState,
} from '@lobechat/agent-runtime';
import debug from 'debug';
import { type Redis } from 'ioredis';

import { hasNonPersistedMessage } from './messagePersistence';
import { getAgentRuntimeRedisClient } from './redis';

const log = debug('lobe-server:agent-runtime:agent-state-manager');

const REFRESH_OWNED_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end";
/**
 * Drop the inline envelope only while this worker still owns the operation lock.
 *
 * An unconditional DEL is unsafe: a redelivery can read envelope k, stall while
 * the active worker finishes k and parks k+1, then lose the lock race and be
 * told its step is stale. Clearing there would delete a live worker's newer
 * recovery pointer. Ownership of the lock is exactly the right predicate —
 * whoever holds it is the worker whose envelope this is.
 *
 * KEYS[1] = operation lock, KEYS[2] = inline resume envelope, ARGV[1] = owner.
 */
const CLEAR_OWNED_INLINE_RESUME_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[2]) else return 0 end";
const RELEASE_OWNED_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
/**
 * Claim the lock, or re-enter it when this exact owner already holds it.
 *
 * Re-entry exists for the inline step loop, which runs several steps under one
 * lock. Owner ids carry a random UUID (see `createStepLockOwner`), so only the
 * invocation that took the lock can present its owner id — a redelivery from
 * the queue always mints a different one and still loses the race.
 */
const CLAIM_OR_REENTER_LOCK_SCRIPT = `
if redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX') then return 1 end
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('expire', KEYS[1], ARGV[2])
  return 1
end
return 0`;

/**
 * Process-local cache of each operation's serialized tool set, keyed by
 * operationId.
 *
 * The tool set is the heaviest thing on an AgentState (manifest schemas + tool
 * definitions, ~300–400 KB) and is immutable for the life of the operation —
 * nothing ever reassigns `state.operationToolSet` after creation. So rather
 * than re-serialize it into the state blob at every step (and re-download it at
 * every step entry), it lives in its own Redis key written once per process,
 * and this cache lets the inline step loop — which runs many steps in one
 * process under one lock — attach it on load without a second Redis round-trip.
 *
 * Bounded + TTL'd: the value is always re-fetchable from Redis, so eviction
 * only costs a re-read. The cached string is exactly what a normal blob parse
 * would have produced, so `JSON.parse(json)` on load yields the same fresh,
 * independent object the old inline path handed each reader.
 */
const TOOLSET_CACHE_MAX = 64;
const toolSetJsonCache = new Map<string, { expiresAt: number; json: string }>();

const readToolSetCache = (operationId: string): string | undefined => {
  const hit = toolSetJsonCache.get(operationId);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    toolSetJsonCache.delete(operationId);
    return undefined;
  }
  // Touch for LRU recency.
  toolSetJsonCache.delete(operationId);
  toolSetJsonCache.set(operationId, hit);
  return hit.json;
};

const writeToolSetCache = (operationId: string, json: string, ttlSeconds: number): void => {
  toolSetJsonCache.delete(operationId);
  toolSetJsonCache.set(operationId, { expiresAt: Date.now() + ttlSeconds * 1000, json });
  while (toolSetJsonCache.size > TOOLSET_CACHE_MAX) {
    const oldest = toolSetJsonCache.keys().next().value;
    if (oldest === undefined) break;
    toolSetJsonCache.delete(oldest);
  }
};

/**
 * Whether a persisted blob may leave its tool set out.
 *
 * Reading the external key and writing it are two separate deploys. A queue
 * continuation targets the shared runtime URL, not a versioned deployment, so
 * during a rolling deploy (or a rollback) an operation saved by this build can
 * next execute on a worker running the previous one — and that worker's
 * `loadAgentState` never reads `agent_runtime_toolset`. Stripping on the first
 * deploy would hand it a blob with no tool set, and the next LLM call would go
 * out with the empty set `selectOperationToolSet` falls back to.
 *
 * So this build ships the reader only: while the flag is off nothing changes —
 * the blob keeps its inline tool set byte-for-byte and no external key is
 * written. Operators flip it on once the previous build has drained, which is
 * when the mixed-version window is gone.
 */
const isToolSetStripEnabled = (): boolean =>
  process.env.AGENT_RUNTIME_STRIP_OPERATION_TOOLSET === '1';

export interface StepResult {
  events?: AgentEvent[];
  executionTime: number;
  newState: AgentState;
  nextContext?: AgentRuntimeContext;
  stepIndex: number;
}

export interface AgentOperationMetadata {
  /**
   * The client that started this operation handles `member_runtime_end`. Only
   * then does the Gateway stream notifier rename a mirrored group member's
   * terminal on this operation's channel; a client released before the rename
   * still gets the verbatim `agent_runtime_end` it retires member columns on.
   */
  acceptsMemberRuntimeEnd?: boolean;
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
  /**
   * Gateway WS channel owner when it differs from the executing user. For
   * shared-agent visitor runs the operation EXECUTES as the creator
   * (`userId`), but only the visitor may subscribe to its stream — the
   * gateway registers the channel under this id and rejects other subs.
   */
  streamOwnerUserId?: string;
  totalCost: number;
  totalSteps: number;
  userId?: string;
  /**
   * Visitor-facing redaction policy for a shared-agent visitor run, mirrored
   * from the share's `AgentShareConfig`. Persisted alongside
   * {@link streamOwnerUserId} so a queue worker that never ran this op's init
   * can still apply the OWNER-configured policy instead of falling back to the
   * fail-closed full strip.
   */
  visitorRedaction?: { showErrorDetails?: boolean; showModelInfo?: boolean };
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
  private readonly TOOLSET_PREFIX = 'agent_runtime_toolset';
  private readonly STEPS_PREFIX = 'agent_runtime_steps';
  private readonly METADATA_PREFIX = 'agent_runtime_meta';
  private readonly INTERRUPT_PREFIX = 'agent_runtime_interrupt';
  private readonly QUEUED_MESSAGES_PREFIX = 'agent_runtime_queued_messages';
  private readonly INLINE_RESUME_PREFIX = 'agent_runtime_inline_resume';
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
    // `operationToolSet` is externalized to its own key (see
    // `externalizeToolSet`) and re-attached on load, so it never travels in the
    // blob — once stripping is enabled. Until then the blob keeps its inline
    // copy so a previous-build worker can still execute the operation (see
    // `isToolSetStripEnabled`). It is immutable after creation, so a single
    // write per operation replaces re-serializing ~300–400 KB of tool schemas
    // at every step.
    const { operationToolSet: _toolSet, ...withoutToolSet } = state as AgentState & {
      operationToolSet?: unknown;
    };
    const persistable = (isToolSetStripEnabled() ? withoutToolSet : state) as AgentState & {
      messages?: unknown;
      operationToolSet?: unknown;
    };
    if (hasNonPersistedMessage(persistable.messages)) {
      return JSON.stringify(persistable);
    }
    const { messages: _messages, ...rest } = persistable;
    return JSON.stringify(rest);
  }

  private toolSetKey(operationId: string): string {
    return `${this.TOOLSET_PREFIX}:${operationId}`;
  }

  /**
   * Persist the operation's tool set to its own key, once per process.
   *
   * Write-once is guarded by the process cache: the first save in a process
   * writes the key and seeds the cache; every later save (each step of an
   * inline loop) finds the cache warm and skips the ~300–400 KB write
   * entirely — the save paths only refresh the key's TTL in lockstep with the
   * state blob. A queue redelivery lands in a fresh process and re-writes once,
   * which is negligible beside the per-step writes it removes.
   */
  private async externalizeToolSet(operationId: string, state: AgentState): Promise<void> {
    const toolSet = (state as { operationToolSet?: unknown }).operationToolSet;
    if (!toolSet) return;
    if (readToolSetCache(operationId)) return;
    const json = JSON.stringify(toolSet);
    await this.redis.setex(this.toolSetKey(operationId), this.DEFAULT_TTL, json);
    writeToolSetCache(operationId, json, this.DEFAULT_TTL);
  }

  /**
   * Re-attach the externalized tool set to a freshly loaded state. Served from
   * the process cache after the first read, so an inline loop reads it from
   * Redis at most once per process. A blob that still carries its tool set
   * inline — written by pre-externalization code during a rolling deploy — is
   * left untouched, and an operation whose key has genuinely gone degrades to
   * the same empty-tool-set fallback the selectors already apply.
   */
  private async rehydrateToolSet(operationId: string, state: AgentState): Promise<void> {
    if ((state as { operationToolSet?: unknown }).operationToolSet) return;
    let json = readToolSetCache(operationId);
    if (!json) {
      json = (await this.redis.get(this.toolSetKey(operationId))) ?? undefined;
      if (json) writeToolSetCache(operationId, json, this.DEFAULT_TTL);
    }
    if (json) {
      (state as { operationToolSet?: unknown }).operationToolSet = JSON.parse(json);
    }
  }

  /**
   * Save Agent state
   */
  async saveAgentState(operationId: string, state: AgentState): Promise<void> {
    const stateKey = `${this.STATE_PREFIX}:${operationId}`;

    try {
      const stripToolSet = isToolSetStripEnabled();
      if (stripToolSet) await this.externalizeToolSet(operationId, state);
      const serializedState = this.serializeStateForPersist(state);
      await this.redis.setex(stateKey, this.DEFAULT_TTL, serializedState);
      // Keep the externalized tool set alive in lockstep with the blob so a
      // long run never loads a stripped blob whose tool set has expired.
      if (stripToolSet) await this.redis.expire(this.toolSetKey(operationId), this.DEFAULT_TTL);

      // Update metadata
      await this.updateOperationMetadata(operationId, {
        lastActiveAt: new Date().toISOString(),
        status: state.status,
        totalCost: state.cost?.total || 0,
        totalSteps: getLlmCallCount(state),
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

      // Blobs written before the typed `world` / `binding` slots existed carry
      // that context in `metadata`; lift it once here so readers see one shape.
      const state = normalizeAgentState(JSON.parse(serializedState) as AgentState);
      await this.rehydrateToolSet(operationId, state);
      log('[%s] Loaded state (step %d)', operationId, state.stepCount);

      return state;
    } catch (error) {
      console.error('Failed to load agent state:', error);
      throw error;
    }
  }

  /**
   * Set the interrupt sentinel. The full state blob can run to hundreds of
   * KB (tool manifests, user memory, …), so the step-abort poller checks
   * this tiny key instead of re-downloading the blob every interval — the
   * blob's `status: 'interrupted'` stays the authoritative record.
   */
  async markInterrupted(operationId: string): Promise<void> {
    await this.redis.setex(`${this.INTERRUPT_PREFIX}:${operationId}`, this.DEFAULT_TTL, '1');
  }

  /**
   * Check the interrupt sentinel without loading the state blob.
   */
  async isInterrupted(operationId: string): Promise<boolean> {
    const exists = await this.redis.exists(`${this.INTERRUPT_PREFIX}:${operationId}`);
    return exists === 1;
  }

  /**
   * Mirror the client's queued-messages flag into a tiny key beside the state,
   * for the same reason as the interrupt sentinel: the step boundary reads it
   * without loading the state blob. Clearing deletes the key.
   */
  async setQueuedMessages(operationId: string, pending: boolean): Promise<void> {
    const key = `${this.QUEUED_MESSAGES_PREFIX}:${operationId}`;
    if (pending) await this.redis.setex(key, this.DEFAULT_TTL, '1');
    else await this.redis.del(key);
  }

  async hasQueuedMessages(operationId: string): Promise<boolean> {
    const exists = await this.redis.exists(`${this.QUEUED_MESSAGES_PREFIX}:${operationId}`);
    return exists === 1;
  }

  /**
   * Save step execution result
   */
  async saveStepResult(operationId: string, stepResult: StepResult): Promise<void> {
    try {
      // Write-once before opening the pipeline; the inline loop warms the cache
      // on its first step and every later step skips the tool-set write.
      const stripToolSet = isToolSetStripEnabled();
      if (stripToolSet) await this.externalizeToolSet(operationId, stepResult.newState);

      const pipeline = this.redis.multi();

      // Save latest state
      const stateKey = `${this.STATE_PREFIX}:${operationId}`;
      pipeline.setex(
        stateKey,
        this.DEFAULT_TTL,
        this.serializeStateForPersist(stepResult.newState),
      );
      // Refresh the externalized tool set's TTL alongside the blob.
      if (stripToolSet) pipeline.expire(this.toolSetKey(operationId), this.DEFAULT_TTL);

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

      // `stepResult.events` is intentionally NOT persisted: nothing ever read
      // the `agent_runtime_events` list back — the same events already reach
      // clients through the live stream and land durably in the operation
      // trace, so the list only duplicated every streamed byte into Redis.

      // Update operation metadata
      const metaKey = `${this.METADATA_PREFIX}:${operationId}`;
      const metadata: Partial<AgentOperationMetadata> = {
        lastActiveAt: new Date().toISOString(),
        status: stepResult.newState.status,
        totalCost: stepResult.newState.cost?.total || 0,
        totalSteps: getLlmCallCount(stepResult.newState),
      };
      pipeline.hmset(metaKey, metadata as any);
      pipeline.expire(metaKey, this.DEFAULT_TTL);

      await pipeline.exec();

      log('[%s:%d] Saved step result', operationId, stepResult.stepIndex);
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
        acceptsMemberRuntimeEnd: metadata.acceptsMemberRuntimeEnd === 'true' || undefined,
        agentConfig: metadata.agentConfig ? JSON.parse(metadata.agentConfig) : undefined,
        visitorRedaction: metadata.visitorRedaction
          ? JSON.parse(metadata.visitorRedaction)
          : undefined,
        createdAt: metadata.createdAt,
        lastActiveAt: metadata.lastActiveAt,
        modelRuntimeConfig: metadata.modelRuntimeConfig
          ? JSON.parse(metadata.modelRuntimeConfig)
          : undefined,
        mirrorToOperationId: metadata.mirrorToOperationId || undefined,
        status: metadata.status as AgentState['status'],
        streamOwnerUserId: metadata.streamOwnerUserId || undefined,
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
      acceptsMemberRuntimeEnd?: boolean;
      agentConfig?: any;
      visitorRedaction?: { showErrorDetails?: boolean; showModelInfo?: boolean };
      mirrorToOperationId?: string;
      modelRuntimeConfig?: any;
      streamOwnerUserId?: string;
      userId?: string;
      workspaceId?: string;
    },
  ): Promise<void> {
    const metaKey = `${this.METADATA_PREFIX}:${operationId}`;

    try {
      const metadata: AgentOperationMetadata = {
        acceptsMemberRuntimeEnd: data.acceptsMemberRuntimeEnd,
        agentConfig: data.agentConfig,
        visitorRedaction: data.visitorRedaction,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        mirrorToOperationId: data.mirrorToOperationId,
        modelRuntimeConfig: data.modelRuntimeConfig,
        status: 'idle',
        streamOwnerUserId: data.streamOwnerUserId,
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
      if (metadata.streamOwnerUserId) redisData.streamOwnerUserId = metadata.streamOwnerUserId;
      if (metadata.workspaceId) redisData.workspaceId = metadata.workspaceId;
      if (metadata.mirrorToOperationId)
        redisData.mirrorToOperationId = metadata.mirrorToOperationId;
      if (metadata.acceptsMemberRuntimeEnd) redisData.acceptsMemberRuntimeEnd = 'true';
      if (metadata.modelRuntimeConfig)
        redisData.modelRuntimeConfig = JSON.stringify(metadata.modelRuntimeConfig);
      if (metadata.agentConfig) redisData.agentConfig = JSON.stringify(metadata.agentConfig);
      if (metadata.visitorRedaction)
        redisData.visitorRedaction = JSON.stringify(metadata.visitorRedaction);

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
      this.toolSetKey(operationId),
      `${this.STEPS_PREFIX}:${operationId}`,
      `${this.METADATA_PREFIX}:${operationId}`,
      `${this.INTERRUPT_PREFIX}:${operationId}`,
      `${this.QUEUED_MESSAGES_PREFIX}:${operationId}`,
      `${this.INLINE_RESUME_PREFIX}:${operationId}`,
    ];

    try {
      toolSetJsonCache.delete(operationId);
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

  /**
   * The inline step loop's envelope for the step it is about to run. This is the
   * queue message that would otherwise be in flight — parked here instead, so a
   * redelivery arriving after the loop died can pick the operation back up from
   * where it actually stopped rather than from the delivered (older) step index.
   */
  async saveInlineResume(operationId: string, serialized: string): Promise<boolean> {
    try {
      await this.redis.setex(
        `${this.INLINE_RESUME_PREFIX}:${operationId}`,
        this.DEFAULT_TTL,
        serialized,
      );
      return true;
    } catch (error) {
      // Reported, never swallowed: the caller must fall back to the queue, or
      // it would run the next step with no recovery path behind it at all.
      console.error('Failed to save inline resume pointer:', error);
      return false;
    }
  }

  /**
   * Deliberately not wrapped in a try/catch. "No envelope" and "could not read
   * the envelope" have opposite consequences: the first means run the delivered
   * step, the second means an operation may be mid-loop with nothing queued
   * behind it. Swallowing the error would ACK that delivery as stale and strand
   * the run, so the failure propagates and the queue retries instead.
   */
  async loadInlineResume(operationId: string): Promise<null | string> {
    return this.redis.get(`${this.INLINE_RESUME_PREFIX}:${operationId}`);
  }

  /**
   * Owner-scoped, and best-effort on failure: a stale envelope is harmless. It
   * only ever resumes a step whose index is ahead of the delivered one, and the
   * next step to park overwrites it — worst case it expires with the
   * operation's TTL. Deleting someone else's envelope is not harmless, hence
   * the ownership check.
   */
  async clearInlineResume(operationId: string, ownerId: string): Promise<void> {
    try {
      await this.redis.eval(
        CLEAR_OWNED_INLINE_RESUME_SCRIPT,
        2,
        this.executionLockKey(operationId),
        `${this.INLINE_RESUME_PREFIX}:${operationId}`,
        ownerId,
      );
    } catch (error) {
      console.error('Failed to clear inline resume pointer:', error);
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
      const result = await this.redis.eval(
        CLAIM_OR_REENTER_LOCK_SCRIPT,
        1,
        this.executionLockKey(operationId),
        ownerId,
        ttlSeconds.toString(),
      );

      return result === 1;
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
