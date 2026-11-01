import { getRedisConfig } from '@/envs/redis';
import {
  type RedisKeyScope,
  RedisKeyScopeNamespace,
  tryInitializeRedisWithPrefix,
} from '@/server/modules/Redis';
import type { BaseRedisProvider } from '@/server/modules/Redis/types';

// The send-path caches are an optimization layered on a hot path, so a send
// must never wait long on Redis. This namespace opts into short provider
// timeouts and bounds the wait for the shared client; after a failure it opens
// a cooldown so an outage degrades every send straight to its live read
// instead of re-paying the connect or a command timeout each time.
const ACQUIRE_TIMEOUT_MS = 1500;
const CONNECT_TIMEOUT_MS = 1000;
const COMMAND_TIMEOUT_MS = 1000;
const COOLDOWN_MS = 30_000;

/**
 * `Date.now()` until which a scope's circuit stays open. Kept per scope so an outage seen
 * by one domain does not switch off another domain's Redis.
 */
const cooldownUntil = new Map<RedisKeyScope, number>();

const openCircuit = (scope: RedisKeyScope) => {
  cooldownUntil.set(scope, Date.now() + COOLDOWN_MS);
};

const withDeadline = async <T>(work: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Report every rejected command to the circuit. A memoized client can outlive
 * Redis: without this, acquisition keeps returning it and — unlike a failed
 * connect — nothing would trip the cooldown, so each send would pay the
 * command timeout before falling back to its live read.
 */
const observeFailures = (client: BaseRedisProvider, scope: RedisKeyScope): BaseRedisProvider =>
  new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;

      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        return result instanceof Promise
          ? result.catch((error) => {
              openCircuit(scope);
              throw error;
            })
          : result;
      };
    },
  });

/**
 * The Redis service client for one {@link RedisKeys} scope, or `null` when Redis is
 * unavailable and the caller should fall back.
 *
 * The client's key prefix is the scope's namespace from {@link RedisKeyScopeNamespace},
 * composed under REDIS_PREFIX, so a domain reading `RedisKeys.<scope>` always writes under
 * that scope's own prefix. Never blocks for long: acquiring the client is bounded by
 * {@link ACQUIRE_TIMEOUT_MS}, and any failure (or a disabled Redis) returns `null`. A failed
 * acquisition, or a command that fails later on the memoized client, opens that scope's
 * circuit for {@link COOLDOWN_MS} so concurrent and later callers degrade to their fallback.
 */
export const getRedisServiceClient = async (
  scope: RedisKeyScope,
): Promise<BaseRedisProvider | null> => {
  const config = getRedisConfig();
  if (!config.enabled || Date.now() < (cooldownUntil.get(scope) ?? 0)) return null;

  const namespace = RedisKeyScopeNamespace[scope];
  const client = await withDeadline(
    tryInitializeRedisWithPrefix(
      { ...config, commandTimeoutMs: COMMAND_TIMEOUT_MS, connectTimeoutMs: CONNECT_TIMEOUT_MS },
      // Compose with REDIS_PREFIX rather than replace it: deployments sharing
      // one Redis isolate by prefix, and their user/device ids can collide.
      config.prefix ? `${config.prefix}:${namespace}` : namespace,
    ),
    ACQUIRE_TIMEOUT_MS,
  );

  if (!client) {
    openCircuit(scope);
    return null;
  }

  return observeFailures(client, scope);
};
