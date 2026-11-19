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

/** HSET + EXPIRE in one step, so a stored request always carries the retention TTL. */
const STORE_SCRIPT = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

/**
 * Compare-and-delete: close the request only if it is still the version that
 * was read (a member may have replaced it after its cooldown ran out), and
 * release the cooldown only if it still belongs to that version.
 */
const REMOVE_SCRIPT = `
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
if ARGV[3] == '1' and redis.call('GET', KEYS[2]) == ARGV[4] then redis.call('DEL', KEYS[2]) end
return 1
`;

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

  /**
   * Open requests of the workspace, newest first. Expired or unreadable
   * entries are pruned on the way, since the shared hash TTL is refreshed by
   * every new request and would otherwise keep them forever.
   */
  async list(workspaceId: string, now = Date.now()): Promise<BudgetRequest[]> {
    try {
      const redis = await getClient();
      if (!redis) return [];

      const key = RedisKeys.lobechat.budgetRequests(workspaceId);
      const entries = Object.entries((await redis.hgetall(key)) ?? {});
      const open: BudgetRequest[] = [];
      const stale: string[] = [];

      for (const [field, raw] of entries) {
        const request = parseRequest(raw);
        if (request && isRetained(request, now)) open.push(request);
        else stale.push(field);
      }

      if (stale.length > 0) await redis.hdel(key, ...stale).catch(() => undefined);

      return open.sort((a, b) => b.createdAt - a.createdAt);
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

      await redis.eval(
        STORE_SCRIPT,
        1,
        RedisKeys.lobechat.budgetRequests(workspaceId),
        input.userId,
        JSON.stringify(request),
        String(BUDGET_REQUEST_RETENTION_SECONDS),
      );

      return { created: true, persisted: true, request };
    } catch (error) {
      warn('store request', workspaceId, error);
      if (claimed) {
        // Undo this attempt's write, if it landed, before giving the claim back,
        // so the caller's `persisted: false` holds and a retry cannot
        // double-notify. Only the exact value written here is removed: an
        // older request that is still open stays.
        await redis
          .eval(
            REMOVE_SCRIPT,
            2,
            RedisKeys.lobechat.budgetRequests(workspaceId),
            cooldownKey,
            input.userId,
            JSON.stringify(request),
            '0',
            '',
          )
          .catch(() => undefined);
        await redis.del(cooldownKey).catch(() => undefined);
      }
      return { created: true, persisted: false, request };
    }
  },

  /**
   * Close the member's request; returns the request that was open, or `null`
   * when there was none (or it was replaced concurrently and is left alone).
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

      const key = RedisKeys.lobechat.budgetRequests(workspaceId);
      const raw = await redis.hget(key, userId);
      if (!raw) return null;

      const request = parseRequest(raw);
      const removed = await redis.eval<number>(
        REMOVE_SCRIPT,
        2,
        key,
        RedisKeys.lobechat.budgetRequestCooldown(workspaceId, userId),
        userId,
        raw,
        keepCooldown ? '0' : '1',
        String(request?.createdAt ?? ''),
      );

      return Number(removed) === 1 && request && isRetained(request, now) ? request : null;
    } catch (error) {
      warn('remove request', workspaceId, error);
      return null;
    }
  },
};
