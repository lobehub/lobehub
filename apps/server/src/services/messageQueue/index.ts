import type {
  ExecAgentResult,
  GatewayQueueContext,
  GatewayQueuedMessage,
  GatewayQueueEnqueueResult,
  GatewayQueueHandoffReceipt,
  GatewayQueueHandoffSnapshot,
  GatewayQueueInspection,
  GatewayQueuePeekResult,
  GatewayQueueRemoveResult,
  GatewayQueueUpdateInput,
  GatewayQueueUpdateResult,
} from '@lobechat/types';
import type Redis from 'ioredis';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { GatewayQueueTenantScope } from './keyBuilder';
import {
  buildGatewayQueueContextKey,
  buildGatewayQueueHandoffReceiptKey,
  buildGatewayQueueOperationKey,
  buildGatewayQueueRedisKeys,
} from './keyBuilder';
import {
  ADOPT_OWNERSHIP_SCRIPT,
  BEGIN_HANDOFF_SCRIPT,
  CANCEL_AND_CLEAR_SCRIPT,
  CLAIM_OR_ENQUEUE_SCRIPT,
  COMMIT_HANDOFF_SCRIPT,
  COMMIT_RECOVERED_CLAIM_SCRIPT,
  FAIL_HANDOFF_SCRIPT,
  INSPECT_AND_REFRESH_SCRIPT,
  RELEASE_OWNED_SCRIPT,
  REMOVE_QUEUED_SCRIPT,
  ROLLBACK_HANDOFF_SCRIPT,
  UPDATE_QUEUED_SCRIPT,
} from './luaScripts';

export type { GatewayQueueRedisKeys, GatewayQueueTenantScope } from './keyBuilder';
export {
  buildGatewayQueueContextKey,
  buildGatewayQueueHandoffReceiptKey,
  buildGatewayQueueOperationKey,
  buildGatewayQueueRedisKeys,
} from './keyBuilder';
export type { MergedGatewayQueuedMessage } from './merge';
export { mergeGatewayQueuedMessages } from './merge';

export interface MessageQueueConfig {
  activeTtlSec: number;
  dedupTtlSec: number;
  handoffTtlSec: number;
  maxQueueLength: number;
  queueTtlSec: number;
  reverseTtlSec: number;
}

export const DEFAULT_MESSAGE_QUEUE_CONFIG: MessageQueueConfig = {
  activeTtlSec: 1800,
  dedupTtlSec: 300,
  handoffTtlSec: 1800,
  maxQueueLength: 50,
  queueTtlSec: 1800,
  reverseTtlSec: 1800,
};

export interface MessageQueueServiceOptions extends GatewayQueueTenantScope {
  config?: Partial<MessageQueueConfig>;
  redis?: Redis | null;
}

export interface ReleaseOwnedOptions {
  /** Remove a claim-only id so a failed startup can be retried safely. */
  dedupId?: string;
  preserveQueue?: boolean;
  /**
   * The recovered snapshot already has durable user/assistant rows. Discard any
   * remaining recovery reservation and retain its dedup id instead of replaying it.
   */
  recoveredBatchPersisted?: boolean;
}

interface BeginHandoffScriptResult {
  code?: 'missing_context' | 'no_pending' | 'not_owner';
  items?: GatewayQueuedMessage[];
  receipt?: GatewayQueueHandoffReceipt;
}

const parseJson = <T>(raw: unknown): T | null => {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error('[Gateway Message Queue] Failed to parse Redis payload:', error);
    return null;
  }
};

const parseQueueItems = (rows: string[]): GatewayQueuedMessage[] =>
  rows
    .map((row) => parseJson<GatewayQueuedMessage>(row))
    .filter((item): item is GatewayQueuedMessage => item !== null);

export class MessageQueueUnavailableError extends Error {
  constructor() {
    super('Gateway MessageQueueService requires Redis');
    this.name = 'MessageQueueUnavailableError';
  }
}

/** Redis-backed queue and operation handoff coordinator for Gateway executions. */
export class MessageQueueService {
  private readonly config: MessageQueueConfig;
  private readonly redisClient: Redis | null;
  private readonly tenant: GatewayQueueTenantScope;

  constructor({ config, redis, userId, workspaceId }: MessageQueueServiceOptions) {
    if (!userId) throw new Error('MessageQueueService requires userId');

    this.config = { ...DEFAULT_MESSAGE_QUEUE_CONFIG, ...config };
    this.redisClient = redis === undefined ? getAgentRuntimeRedisClient() : redis;
    this.tenant = { userId, workspaceId };
  }

  private get redis(): Redis {
    if (!this.redisClient) throw new MessageQueueUnavailableError();
    return this.redisClient;
  }

  private contextKey(context: GatewayQueueContext): string {
    if (!context.agentId || !context.topicId) {
      throw new Error('Gateway queue context requires agentId and topicId');
    }

    return buildGatewayQueueContextKey(this.tenant, context);
  }

  private async eval(
    script: string,
    keys: string[],
    args: Array<number | string>,
  ): Promise<unknown> {
    return this.redis.eval(script, keys.length, ...keys, ...args);
  }

  /** Atomically claim an idle context or append the message behind its active owner. */
  async claimOrEnqueue(
    context: GatewayQueueContext,
    proposedOperationId: string,
    message: GatewayQueuedMessage,
  ): Promise<GatewayQueueEnqueueResult> {
    const contextKey = this.contextKey(context);
    const keys = buildGatewayQueueRedisKeys(contextKey);
    const reverseKey = buildGatewayQueueOperationKey(this.tenant, proposedOperationId);
    const raw = await this.eval(
      CLAIM_OR_ENQUEUE_SCRIPT,
      [
        keys.active,
        keys.queue,
        keys.dedup,
        reverseKey,
        keys.context,
        keys.inflight,
        keys.handoffPointer,
      ],
      [
        JSON.stringify(message),
        message.id,
        proposedOperationId,
        contextKey,
        JSON.stringify(context),
        this.config.maxQueueLength,
        this.config.activeTtlSec,
        this.config.queueTtlSec,
        this.config.dedupTtlSec,
        this.config.reverseTtlSec,
      ],
    );
    const result = parseJson<GatewayQueueEnqueueResult>(raw);
    if (!result) throw new Error('Gateway message queue returned an invalid enqueue result');

    return result;
  }

  /** Drop an idle backlog reservation after its replacement operation is durably created. */
  async commitRecoveredClaim(operationId: string): Promise<boolean> {
    const reverseKey = buildGatewayQueueOperationKey(this.tenant, operationId);
    const contextKey = await this.redis.get(reverseKey);
    if (!contextKey) return false;

    const keys = buildGatewayQueueRedisKeys(contextKey);
    const result = await this.eval(
      COMMIT_RECOVERED_CLAIM_SCRIPT,
      [keys.active, reverseKey, keys.inflight, keys.handoffPointer],
      [operationId, contextKey],
    );

    return result === 1;
  }

  /**
   * Transfer a parked operation's queue lease to its fresh resume operation.
   * If the parked owner already compare-released, the new operation may claim
   * the idle context while preserving its pending rows.
   */
  async adoptOwnership(
    context: GatewayQueueContext,
    nextOperationId: string,
    expectedOldOperationId?: string,
  ): Promise<boolean> {
    const contextKey = this.contextKey(context);
    const keys = buildGatewayQueueRedisKeys(contextKey);
    const nextReverseKey = buildGatewayQueueOperationKey(this.tenant, nextOperationId);
    const oldReverseKey = expectedOldOperationId
      ? buildGatewayQueueOperationKey(this.tenant, expectedOldOperationId)
      : `${contextKey}:unused-old-operation`;
    const result = await this.eval(
      ADOPT_OWNERSHIP_SCRIPT,
      [keys.active, nextReverseKey, keys.context, oldReverseKey, keys.queue, keys.dedup],
      [
        contextKey,
        nextOperationId,
        expectedOldOperationId ?? '',
        JSON.stringify(context),
        this.config.activeTtlSec,
        this.config.queueTtlSec,
        this.config.dedupTtlSec,
        this.config.reverseTtlSec,
      ],
    );

    return result === 1;
  }

  /** Verify operation ownership, renew its leases, and report whether a handoff is needed. */
  async inspectAndRefresh(operationId: string): Promise<GatewayQueueInspection | null> {
    const reverseKey = buildGatewayQueueOperationKey(this.tenant, operationId);
    const contextKey = await this.redis.get(reverseKey);
    if (!contextKey) return null;

    const keys = buildGatewayQueueRedisKeys(contextKey);
    const raw = await this.eval(
      INSPECT_AND_REFRESH_SCRIPT,
      [keys.active, keys.queue, keys.dedup, reverseKey, keys.context],
      [
        operationId,
        contextKey,
        this.config.activeTtlSec,
        this.config.queueTtlSec,
        this.config.dedupTtlSec,
        this.config.reverseTtlSec,
      ],
    );

    return parseJson<GatewayQueueInspection>(raw);
  }

  /**
   * Reserve the current pending snapshot and transfer ownership without an unlocked window.
   * Retries return the first receipt and its actual nextOperationId, even when proposedNext differs.
   */
  async beginHandoff(
    oldOperationId: string,
    proposedNextOperationId: string,
  ): Promise<GatewayQueueHandoffSnapshot | null> {
    const receiptKey = buildGatewayQueueHandoffReceiptKey(this.tenant, oldOperationId);
    const existingReceipt = parseJson<GatewayQueueHandoffReceipt>(await this.redis.get(receiptKey));
    const oldReverseKey = buildGatewayQueueOperationKey(this.tenant, oldOperationId);
    const contextKey = existingReceipt
      ? this.contextKey(existingReceipt.context)
      : await this.redis.get(oldReverseKey);
    if (!contextKey) return null;

    const keys = buildGatewayQueueRedisKeys(contextKey);
    const proposedNextReverseKey = buildGatewayQueueOperationKey(
      this.tenant,
      proposedNextOperationId,
    );
    const raw = await this.eval(
      BEGIN_HANDOFF_SCRIPT,
      [
        keys.active,
        keys.queue,
        keys.inflight,
        keys.dedup,
        oldReverseKey,
        proposedNextReverseKey,
        keys.context,
        receiptKey,
        keys.handoffPointer,
      ],
      [
        oldOperationId,
        proposedNextOperationId,
        contextKey,
        this.config.activeTtlSec,
        this.config.queueTtlSec,
        this.config.dedupTtlSec,
        this.config.reverseTtlSec,
        this.config.handoffTtlSec,
      ],
    );
    const result = parseJson<BeginHandoffScriptResult>(raw);
    if (!result?.receipt) return null;

    return { ...result.receipt, items: result.items ?? [] };
  }

  /** Read the durable receipt used by completion/QStash retries. */
  async getHandoffReceipt(oldOperationId: string): Promise<GatewayQueueHandoffReceipt | null> {
    const key = buildGatewayQueueHandoffReceiptKey(this.tenant, oldOperationId);
    return parseJson<GatewayQueueHandoffReceipt>(await this.redis.get(key));
  }

  /** Commit a successfully-created next operation and retain a TTL receipt. */
  async commitHandoff(oldOperationId: string, nextOperation: ExecAgentResult): Promise<boolean> {
    return this.finalizeHandoff('committed', oldOperationId, nextOperation);
  }

  /**
   * Finalize an unsuccessful execAgent result without restoring already-persisted user rows.
   * New messages queued during handoff remain pending while next ownership is released.
   */
  async failHandoff(oldOperationId: string, nextOperation: ExecAgentResult): Promise<boolean> {
    return this.finalizeHandoff('failed', oldOperationId, nextOperation);
  }

  private async finalizeHandoff(
    status: 'committed' | 'failed',
    oldOperationId: string,
    nextOperation: ExecAgentResult,
  ): Promise<boolean> {
    const receipt = await this.getHandoffReceipt(oldOperationId);
    if (!receipt || receipt.nextOperationId !== nextOperation.operationId) return false;

    const contextKey = this.contextKey(receipt.context);
    const keys = buildGatewayQueueRedisKeys(contextKey);
    const oldReverseKey = buildGatewayQueueOperationKey(this.tenant, oldOperationId);
    const nextReverseKey = buildGatewayQueueOperationKey(this.tenant, receipt.nextOperationId);
    const receiptKey = buildGatewayQueueHandoffReceiptKey(this.tenant, oldOperationId);
    const script = status === 'committed' ? COMMIT_HANDOFF_SCRIPT : FAIL_HANDOFF_SCRIPT;
    const args =
      status === 'committed'
        ? [
            oldOperationId,
            receipt.nextOperationId,
            JSON.stringify(nextOperation),
            this.config.activeTtlSec,
            this.config.queueTtlSec,
            this.config.dedupTtlSec,
            this.config.reverseTtlSec,
            this.config.handoffTtlSec,
          ]
        : [
            oldOperationId,
            receipt.nextOperationId,
            JSON.stringify(nextOperation),
            this.config.queueTtlSec,
            this.config.dedupTtlSec,
            this.config.queueTtlSec,
            this.config.handoffTtlSec,
          ];
    const result = await this.eval(
      script,
      [
        keys.active,
        keys.inflight,
        oldReverseKey,
        nextReverseKey,
        receiptKey,
        keys.queue,
        keys.dedup,
        keys.context,
        keys.handoffPointer,
      ],
      args,
    );

    return result === 1;
  }

  /** Restore an unconsumed snapshot to the queue head and release proposed-next ownership. */
  async rollbackHandoff(oldOperationId: string, nextOperationId: string): Promise<boolean> {
    const receipt = await this.getHandoffReceipt(oldOperationId);
    if (!receipt || receipt.nextOperationId !== nextOperationId) return false;

    const contextKey = this.contextKey(receipt.context);
    const keys = buildGatewayQueueRedisKeys(contextKey);
    const result = await this.eval(
      ROLLBACK_HANDOFF_SCRIPT,
      [
        keys.active,
        keys.inflight,
        buildGatewayQueueOperationKey(this.tenant, oldOperationId),
        buildGatewayQueueOperationKey(this.tenant, nextOperationId),
        buildGatewayQueueHandoffReceiptKey(this.tenant, oldOperationId),
        keys.queue,
        keys.dedup,
        keys.context,
        keys.handoffPointer,
      ],
      [
        oldOperationId,
        nextOperationId,
        this.config.queueTtlSec,
        this.config.dedupTtlSec,
        this.config.reverseTtlSec,
        this.config.handoffTtlSec,
      ],
    );

    return result === 1;
  }

  /** Release only when operationId still owns the context. Pending rows are preserved by default. */
  async releaseOwned(
    operationId: string,
    { dedupId, preserveQueue = true, recoveredBatchPersisted = false }: ReleaseOwnedOptions = {},
  ): Promise<boolean> {
    const reverseKey = buildGatewayQueueOperationKey(this.tenant, operationId);
    const contextKey = await this.redis.get(reverseKey);
    if (!contextKey) return false;

    const keys = buildGatewayQueueRedisKeys(contextKey);
    const result = await this.eval(
      RELEASE_OWNED_SCRIPT,
      [
        keys.active,
        keys.queue,
        keys.dedup,
        reverseKey,
        keys.context,
        keys.inflight,
        keys.handoffPointer,
      ],
      [
        operationId,
        contextKey,
        preserveQueue ? '1' : '0',
        this.config.queueTtlSec,
        this.config.dedupTtlSec,
        dedupId ?? '',
        recoveredBatchPersisted ? '1' : '0',
      ],
    );

    return result === 1;
  }

  async peek(context: GatewayQueueContext): Promise<GatewayQueuePeekResult> {
    const keys = buildGatewayQueueRedisKeys(this.contextKey(context));
    const [activeOperationId, rows] = await Promise.all([
      this.redis.get(keys.active),
      this.redis.lrange(keys.queue, 0, -1),
    ]);

    return { activeOperationId, items: parseQueueItems(rows) };
  }

  async update(
    context: GatewayQueueContext,
    queueId: string,
    patch: GatewayQueueUpdateInput,
  ): Promise<GatewayQueueUpdateResult> {
    const { queue } = buildGatewayQueueRedisKeys(this.contextKey(context));
    const raw = await this.eval(
      UPDATE_QUEUED_SCRIPT,
      [queue],
      [queueId, JSON.stringify(patch), this.config.queueTtlSec],
    );
    const item = parseJson<GatewayQueuedMessage>(raw);

    return { item, updated: item !== null };
  }

  async remove(context: GatewayQueueContext, queueId: string): Promise<GatewayQueueRemoveResult> {
    const keys = buildGatewayQueueRedisKeys(this.contextKey(context));
    const raw = await this.eval(
      REMOVE_QUEUED_SCRIPT,
      [keys.queue, keys.dedup],
      [queueId, this.config.queueTtlSec, this.config.dedupTtlSec],
    );

    return { queueId, removed: parseJson<GatewayQueuedMessage>(raw) !== null };
  }

  /** Clear a context, including an in-progress handoff, retrying if ownership changes mid-read. */
  async cancelAndClear(context: GatewayQueueContext): Promise<void> {
    const contextKey = this.contextKey(context);
    const keys = buildGatewayQueueRedisKeys(contextKey);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [activeOperationId, handoffOperationId] = await this.redis.mget(
        keys.active,
        keys.handoffPointer,
      );
      const reverseKey = activeOperationId
        ? buildGatewayQueueOperationKey(this.tenant, activeOperationId)
        : '';
      const receiptKey = handoffOperationId
        ? buildGatewayQueueHandoffReceiptKey(this.tenant, handoffOperationId)
        : '';
      const result = await this.eval(
        CANCEL_AND_CLEAR_SCRIPT,
        [
          keys.active,
          keys.queue,
          keys.dedup,
          keys.context,
          keys.inflight,
          keys.handoffPointer,
          reverseKey,
          receiptKey,
        ],
        [activeOperationId ?? '', handoffOperationId ?? ''],
      );
      if (result === 1) return;
    }

    throw new Error('Gateway message queue ownership changed while clearing context');
  }
}

export type MessageQueueFactoryOptions = Omit<MessageQueueServiceOptions, 'redis'>;

export const getMessageQueueService = (
  options: MessageQueueFactoryOptions,
): MessageQueueService | null => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  return new MessageQueueService({ ...options, redis });
};
