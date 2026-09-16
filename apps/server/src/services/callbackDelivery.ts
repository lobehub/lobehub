import type Redis from 'ioredis';

const CALLBACK_DELIVERY_TTL_SECONDS = 6 * 60 * 60;
const CALLBACK_DELIVERY_LEASE_MS = 90 * 1000;

const MARK_DELIVERY_CHUNK_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local next = tonumber(ARGV[1])
if next > current then redis.call('SET', KEYS[1], next, 'EX', ARGV[2]) end
return math.max(current, next)
`;

const CLAIM_DELIVERY_CHUNK_SCRIPT = `
local owner = redis.call('GET', KEYS[2])
if owner and owner ~= ARGV[3] then return -2 end
redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local next = tonumber(ARGV[1])
if current >= next then return 0 end
if current ~= next - 1 then return -1 end
redis.call('SET', KEYS[1], next, 'EX', ARGV[2])
return 1
`;
const RELEASE_DELIVERY_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

export const getDeliveredChunkCount = async (redis: Redis, key: string): Promise<number> =>
  Number((await redis.get(key)) || 0);

/**
 * Reserve a chunk before dispatching it to an external platform. Telegram has
 * no idempotency key for send/edit APIs, so an ambiguous timeout must be
 * treated as possibly delivered. Persisting this monotonic dispatch cursor
 * first gives callbacks at-most-once delivery across retries and workers.
 */
export const claimDeliveryChunk = async (
  redis: Redis,
  key: string,
  deliveredChunkCount: number,
  owner: string,
): Promise<boolean> => {
  const result = await redis.eval(
    CLAIM_DELIVERY_CHUNK_SCRIPT,
    2,
    key,
    `${key}:lease`,
    deliveredChunkCount,
    CALLBACK_DELIVERY_TTL_SECONDS,
    owner,
    CALLBACK_DELIVERY_LEASE_MS,
  );
  if (result === -2) throw new Error('Completion delivery is already in progress');
  return result === 1;
};

export const releaseDeliveryLease = async (
  redis: Redis,
  key: string,
  owner: string,
): Promise<void> => {
  await redis.eval(RELEASE_DELIVERY_LEASE_SCRIPT, 1, `${key}:lease`, owner);
};

export const markDeliveryChunk = async (
  redis: Redis,
  key: string,
  deliveredChunkCount: number,
): Promise<void> => {
  await redis.eval(
    MARK_DELIVERY_CHUNK_SCRIPT,
    1,
    key,
    deliveredChunkCount,
    CALLBACK_DELIVERY_TTL_SECONDS,
  );
};
