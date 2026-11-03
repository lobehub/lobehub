import type Redis from 'ioredis';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const PREFIX = 'task-result-callback:';
const RECEIPT_TTL_SECONDS = 6 * 60 * 60;
const PENDING_RETRY_DELAY_MS = 60_000;
const PROCESSING_TIMEOUT_MS = 35 * 60_000;

const MARK_DELIVERY_CHUNK_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local next = tonumber(ARGV[1])
if next > current then redis.call('SET', KEYS[1], next, 'EX', ARGV[2]) end
return math.max(current, next)
`;

export interface TaskResultCallbackReceipt {
  attempts: number;
  callbackMessageId: string;
  creatorOperationId?: string;
  error?: string;
  id: string;
  operationId: string;
  originTopicId: string;
  status: 'pending' | 'processing';
  taskId: string;
  taskTopicId?: string;
  updatedAt: number;
  userId: string;
  workspaceId: string | undefined;
}

export interface TaskResultCallbackScope {
  agentId: string;
  originTopicId: string;
  scopeKey: string;
  userId: string;
  workspaceId: string | undefined;
}

interface CreatePendingParams {
  agentId: string;
  callbackMessageId: string;
  operationId: string;
  taskId: string;
  taskTopicId?: string;
}

const CREATE_PENDING_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status then return status end
redis.call('HSET', KEYS[1], unpack(ARGV, 1, 22))
redis.call('EXPIRE', KEYS[1], ARGV[23])
redis.call('ZADD', KEYS[2], ARGV[24], ARGV[25])
redis.call('EXPIRE', KEYS[2], ARGV[23])
redis.call('HSET', KEYS[3], unpack(ARGV, 26, 33))
redis.call('EXPIRE', KEYS[3], ARGV[23])
redis.call('ZADD', KEYS[4], ARGV[34], ARGV[35])
return 'pending'
`;

const CLAIM_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then return {} end
local ids = redis.call('ZRANGE', KEYS[1], 0, -1)
if #ids == 0 then
  redis.call('ZREM', KEYS[3], ARGV[1])
  return {}
end
redis.call('DEL', KEYS[2])
for _, id in ipairs(ids) do
  redis.call('RPUSH', KEYS[2], id)
  redis.call('HSET', ARGV[2] .. id, 'status', 'processing', 'updatedAt', ARGV[3])
  redis.call('HINCRBY', ARGV[2] .. id, 'attempts', 1)
  redis.call('ZREM', KEYS[1], id)
end
redis.call('EXPIRE', KEYS[2], ARGV[4])
redis.call('SET', KEYS[4], ARGV[3], 'EX', ARGV[4])
redis.call('ZADD', KEYS[3], ARGV[5], ARGV[1])
return ids
`;

const RELEASE_SCRIPT = `
redis.call('DEL', KEYS[2], KEYS[3])
for index = 7, #ARGV do
  local id = ARGV[index]
  redis.call('HSET', ARGV[1] .. id, 'status', 'pending', 'creatorOperationId', '', 'error', ARGV[2], 'updatedAt', ARGV[3])
  redis.call('ZADD', KEYS[1], ARGV[3], id)
end
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('ZADD', KEYS[4], ARGV[5], ARGV[6])
return #ARGV - 6
`;

const SETTLE_SCRIPT = `
redis.call('DEL', KEYS[1], KEYS[2])
for index = 6, #ARGV do
  local id = ARGV[index]
  redis.call('HSET', ARGV[1] .. id, 'status', 'delivered', 'updatedAt', ARGV[2])
  redis.call('EXPIRE', ARGV[1] .. id, ARGV[3])
end
if redis.call('ZCARD', KEYS[3]) == 0 then
  redis.call('ZREM', KEYS[4], ARGV[4])
else
  redis.call('ZADD', KEYS[4], ARGV[5], ARGV[4])
end
return #ARGV - 5
`;

const parseReceipt = (payload: Record<string, string>): TaskResultCallbackReceipt | undefined => {
  if (!payload.id || !payload.operationId || !payload.originTopicId || !payload.userId) return;
  if (payload.status !== 'pending' && payload.status !== 'processing') return;

  return {
    attempts: Number(payload.attempts || 0),
    callbackMessageId: payload.callbackMessageId,
    creatorOperationId: payload.creatorOperationId || undefined,
    error: payload.error || undefined,
    id: payload.id,
    operationId: payload.operationId,
    originTopicId: payload.originTopicId,
    status: payload.status,
    taskId: payload.taskId,
    taskTopicId: payload.taskTopicId || undefined,
    updatedAt: Number(payload.updatedAt),
    userId: payload.userId,
    workspaceId: payload.workspaceId || undefined,
  };
};

export class TaskResultCallbackRedisStore {
  private readonly redis: Redis;
  private readonly scopeKey: string;

  constructor(
    private readonly userId: string,
    private readonly originTopicId: string,
    private readonly workspaceId?: string,
    redis = getAgentRuntimeRedisClient(),
  ) {
    if (!redis) throw new Error('Redis is required for task result callbacks');
    this.redis = redis;
    this.scopeKey = `${userId}:${workspaceId || 'personal'}:${originTopicId}`;
  }

  static async findRecoverableScopes(
    redis = getAgentRuntimeRedisClient(),
  ): Promise<TaskResultCallbackScope[]> {
    if (!redis) throw new Error('Redis is required for task result callbacks');
    const scopeKeys = await redis.zrange(
      `${PREFIX}recovery`,
      '-inf',
      Date.now(),
      'BYSCORE',
      'LIMIT',
      0,
      100,
    );
    const scopes = await Promise.all(
      scopeKeys.map(async (scopeKey) => {
        const payload = await redis.hgetall(`${PREFIX}scope:${scopeKey}`);
        if (!payload.agentId || !payload.originTopicId || !payload.userId) return;
        return {
          agentId: payload.agentId,
          originTopicId: payload.originTopicId,
          scopeKey,
          userId: payload.userId,
          workspaceId: payload.workspaceId || undefined,
        };
      }),
    );
    const missingScopeKeys = scopeKeys.filter((_, index) => !scopes[index]);
    if (missingScopeKeys.length > 0) {
      await redis.zrem(`${PREFIX}recovery`, ...missingScopeKeys);
    }
    return scopes.filter((scope): scope is TaskResultCallbackScope => Boolean(scope));
  }

  async createPending(params: CreatePendingParams): Promise<void> {
    const now = Date.now();
    await this.redis.eval(
      CREATE_PENDING_SCRIPT,
      4,
      this.receiptKey(params.operationId),
      this.pendingKey,
      this.scopeMetadataKey,
      `${PREFIX}recovery`,
      'attempts',
      '0',
      'callbackMessageId',
      params.callbackMessageId,
      'id',
      params.operationId,
      'operationId',
      params.operationId,
      'originTopicId',
      this.originTopicId,
      'status',
      'pending',
      'taskId',
      params.taskId,
      'taskTopicId',
      params.taskTopicId || '',
      'updatedAt',
      String(now),
      'userId',
      this.userId,
      'workspaceId',
      this.workspaceId || '',
      String(RECEIPT_TTL_SECONDS),
      String(now),
      params.operationId,
      'agentId',
      params.agentId,
      'originTopicId',
      this.originTopicId,
      'userId',
      this.userId,
      'workspaceId',
      this.workspaceId || '',
      String(now + PENDING_RETRY_DELAY_MS),
      this.scopeKey,
    );
  }

  async getDeliveredChunkCount(operationId: string): Promise<number> {
    return Number((await this.redis.get(this.deliveryKey(operationId))) || 0);
  }

  async markDeliveryChunk(operationId: string, deliveredChunkCount: number): Promise<void> {
    await this.redis.eval(
      MARK_DELIVERY_CHUNK_SCRIPT,
      1,
      this.deliveryKey(operationId),
      deliveredChunkCount,
      RECEIPT_TTL_SECONDS,
    );
  }

  async claimPending(): Promise<TaskResultCallbackReceipt[]> {
    const now = Date.now();
    const ids = (await this.redis.eval(
      CLAIM_SCRIPT,
      4,
      this.pendingKey,
      this.processingKey,
      `${PREFIX}recovery`,
      this.processingStartedAtKey,
      this.scopeKey,
      `${PREFIX}receipt:`,
      String(now),
      String(RECEIPT_TTL_SECONDS),
      String(now + PROCESSING_TIMEOUT_MS),
    )) as string[];
    const receipts = await Promise.all(ids.map((id) => this.redis.hgetall(this.receiptKey(id))));
    return receipts
      .map(parseReceipt)
      .filter((receipt): receipt is TaskResultCallbackReceipt => Boolean(receipt));
  }

  async attachCreatorOperation(ids: string[], creatorOperationId: string): Promise<void> {
    if (ids.length === 0) return;
    const transaction = this.redis.multi();
    for (const id of ids) {
      transaction.hset(this.receiptKey(id), { creatorOperationId, updatedAt: String(Date.now()) });
    }
    await transaction.exec();
  }

  async areDelivered(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const statuses = await Promise.all(
      ids.map((id) => this.redis.hget(this.receiptKey(id), 'status')),
    );
    return statuses.every((status) => status === 'delivered');
  }

  async release(ids: string[], error: string): Promise<void> {
    if (ids.length === 0) return;
    const now = Date.now();
    await this.redis.eval(
      RELEASE_SCRIPT,
      4,
      this.pendingKey,
      this.processingKey,
      this.processingStartedAtKey,
      `${PREFIX}recovery`,
      `${PREFIX}receipt:`,
      error,
      String(now),
      String(RECEIPT_TTL_SECONDS),
      String(now + PENDING_RETRY_DELAY_MS),
      this.scopeKey,
      ...ids,
    );
  }

  async resetStaleProcessing(): Promise<void> {
    const startedAt = Number((await this.redis.get(this.processingStartedAtKey)) || 0);
    if (!startedAt || startedAt > Date.now() - PROCESSING_TIMEOUT_MS) return;
    const ids = await this.redis.lrange(this.processingKey, 0, -1);
    await this.release(ids, 'Creator callback processing timed out');
  }

  async settle(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.redis.eval(
      SETTLE_SCRIPT,
      4,
      this.processingKey,
      this.processingStartedAtKey,
      this.pendingKey,
      `${PREFIX}recovery`,
      `${PREFIX}receipt:`,
      String(Date.now()),
      String(RECEIPT_TTL_SECONDS),
      this.scopeKey,
      String(Date.now() + PENDING_RETRY_DELAY_MS),
      ...ids,
    );
  }

  private get pendingKey() {
    return `${PREFIX}pending:${this.scopeKey}`;
  }

  private get processingKey() {
    return `${PREFIX}processing:${this.scopeKey}`;
  }

  private get processingStartedAtKey() {
    return `${PREFIX}processing-started:${this.scopeKey}`;
  }

  private receiptKey(operationId: string) {
    return `${PREFIX}receipt:${operationId}`;
  }

  private deliveryKey(operationId: string) {
    return `${PREFIX}delivery:${operationId}`;
  }

  private get scopeMetadataKey() {
    return `${PREFIX}scope:${this.scopeKey}`;
  }
}
