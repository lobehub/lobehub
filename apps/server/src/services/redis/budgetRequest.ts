import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('lobechat');

/**
 * How long a member waits before the same request can be sent again. Resolving
 * the request lifts it at once unless the resolver keeps it.
 */
export const BUDGET_REQUEST_COOLDOWN_SECONDS = 24 * 60 * 60;

/** How long an unanswered request stays open. */
export const BUDGET_REQUEST_RETENTION_SECONDS = 7 * 24 * 60 * 60;

export interface BudgetRequest {
  /** Epoch ms. Stable for the life of the request, so it can anchor dedupe keys. */
  createdAt: number;
  note?: string;
  /** Amount the member asks for. */
  requestedAmount?: number;
  userId: string;
}

export interface CreateBudgetRequestResult {
  /** `false` when the member is still cooling down: nothing new was stored. */
  created: boolean;
  /** `false` when Redis could not hold the request. */
  persisted: boolean;
  /** The stored request; `null` when cooling down without an open request. */
  request: BudgetRequest | null;
}

const parseRequest = (raw: string | null | undefined): BudgetRequest | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BudgetRequest>;
    if (typeof value.userId !== 'string' || typeof value.createdAt !== 'number') return null;

    return {
      createdAt: value.createdAt,
      ...(typeof value.note === 'string' && value.note ? { note: value.note } : {}),
      ...(typeof value.requestedAmount === 'number'
        ? { requestedAmount: value.requestedAmount }
        : {}),
      userId: value.userId,
    };
  } catch {
    return null;
  }
};

const isRetained = (request: BudgetRequest, now: number) =>
  now - request.createdAt < BUDGET_REQUEST_RETENTION_SECONDS * 1000;

/** Whether the request is still inside its cooldown. */
export const isBudgetRequestCoolingDown = (request: BudgetRequest, now = Date.now()) =>
  now - request.createdAt < BUDGET_REQUEST_COOLDOWN_SECONDS * 1000;

const warn = (action: string, workspaceId: string, error: unknown) =>
  console.warn(`[redisService.budgetRequest] Failed to ${action}`, { error, workspaceId });

export const budgetRequest = {
  async get(workspaceId: string, userId: string, now = Date.now()) {
    try {
      const redis = await getClient();
      if (!redis) return null;

      const request = parseRequest(
        await redis.hget(RedisKeys.lobechat.budgetRequests(workspaceId), userId),
      );
      return request && isRetained(request, now) ? request : null;
    } catch (error) {
      warn('read request', workspaceId, error);
      return null;
    }
  },

  /** Open requests of the workspace, newest first. */
  async list(workspaceId: string, now = Date.now()): Promise<BudgetRequest[]> {
    try {
      const redis = await getClient();
      if (!redis) return [];

      const entries = await redis.hgetall(RedisKeys.lobechat.budgetRequests(workspaceId));
      return Object.values(entries ?? {})
        .map(parseRequest)
        .filter((request): request is BudgetRequest => !!request && isRetained(request, now))
        .sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      warn('list requests', workspaceId, error);
      return [];
    }
  },

  /**
   * Store a request unless the member is cooling down. The cooldown is claimed
   * with `SET NX` first, so concurrent calls resolve to exactly one
   * `created: true`; when the request then cannot be stored the claim is
   * released, so a failed write never leaves the member locked out.
   */
  async create(
    workspaceId: string,
    input: Omit<BudgetRequest, 'createdAt'>,
    now = Date.now(),
  ): Promise<CreateBudgetRequestResult> {
    const request: BudgetRequest = { ...input, createdAt: now };
    const redis = await getClient().catch(() => null);
    if (!redis) return { created: true, persisted: false, request };

    const cooldownKey = RedisKeys.lobechat.budgetRequestCooldown(workspaceId, input.userId);
    let claimed = false;

    try {
      claimed =
        (await redis.set(cooldownKey, String(now), {
          ex: BUDGET_REQUEST_COOLDOWN_SECONDS,
          nx: true,
        })) !== null;

      if (!claimed) {
        return {
          created: false,
          persisted: true,
          request: await budgetRequest.get(workspaceId, input.userId, now),
        };
      }

      const key = RedisKeys.lobechat.budgetRequests(workspaceId);
      await redis.hset(key, input.userId, JSON.stringify(request));
      await redis.expire(key, BUDGET_REQUEST_RETENTION_SECONDS);

      return { created: true, persisted: true, request };
    } catch (error) {
      warn('store request', workspaceId, error);
      if (claimed) await redis.del(cooldownKey).catch(() => undefined);
      return { created: true, persisted: false, request };
    }
  },

  /**
   * Close the member's request; returns the request that was open.
   * `keepCooldown` leaves the cooldown running, so a dismissed request cannot
   * be sent again right away.
   */
  async remove(
    workspaceId: string,
    userId: string,
    { keepCooldown = false, now = Date.now() }: { keepCooldown?: boolean; now?: number } = {},
  ): Promise<BudgetRequest | null> {
    try {
      const redis = await getClient();
      if (!redis) return null;

      const request = await budgetRequest.get(workspaceId, userId, now);
      await redis.hdel(RedisKeys.lobechat.budgetRequests(workspaceId), userId);
      if (!keepCooldown) {
        await redis.del(RedisKeys.lobechat.budgetRequestCooldown(workspaceId, userId));
      }

      return request;
    } catch (error) {
      warn('remove request', workspaceId, error);
      return null;
    }
  },
};
