import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { and, eq, gte, isNotNull, or, sql } from 'drizzle-orm';

import { asyncTasks, generationBatches, generations } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled, type RedisClient } from '@/libs/redis';

const CACHE_KEY_PREFIX = 'video:avg_latency';
const CACHE_TTL_SECONDS = 300; // 5 minutes

/** Trim ratio: remove top/bottom 10% of samples before averaging */
const TRIM_RATIO = 0.1;

export interface VideoModelRef {
  model: string;
  provider: string;
}

/** Stable map key for a provider-scoped video model. */
export const getVideoLatencyKey = ({ model, provider }: VideoModelRef) => `${provider}\0${model}`;

async function getRedis(): Promise<RedisClient | null> {
  const config = getRedisConfig();
  if (!isRedisEnabled(config)) return null;

  return initializeRedis(config);
}

const getCacheKey = ({ model, provider }: VideoModelRef) =>
  `${CACHE_KEY_PREFIX}:${provider}:${model}`;

const formatModelRefs = (refs: VideoModelRef[]) =>
  refs.map(({ model, provider }) => `${provider}/${model}`).join(', ');

function trimmedAverage(latencies: number[]): number | null {
  if (latencies.length === 0) return null;

  // Not enough samples to trim meaningfully, just average all
  if (latencies.length < 5) {
    const sum = latencies.reduce((acc, v) => acc + v, 0);
    return Math.round(sum / latencies.length);
  }

  const trimCount = Math.floor(latencies.length * TRIM_RATIO);
  const trimmed = latencies.slice(trimCount, latencies.length - trimCount);

  const sum = trimmed.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / trimmed.length);
}

/**
 * Loads the last three days of successful durations for every requested model in one query,
 * then computes each model's trimmed mean in memory.
 */
async function queryTrimmedAvgLatencies(
  refs: VideoModelRef[],
): Promise<Map<string, number | null>> {
  const db = await getServerDB();

  const threeDaysAgo = sql`NOW() - INTERVAL '3 days'`;

  const rows = await db
    .select({
      latency: asyncTasks.duration,
      model: generationBatches.model,
      provider: generationBatches.provider,
    })
    .from(asyncTasks)
    .innerJoin(generations, eq(generations.asyncTaskId, asyncTasks.id))
    .innerJoin(generationBatches, eq(generations.generationBatchId, generationBatches.id))
    .where(
      and(
        eq(asyncTasks.type, AsyncTaskType.VideoGeneration),
        eq(asyncTasks.status, AsyncTaskStatus.Success),
        or(
          ...refs.map(({ model, provider }) =>
            and(eq(generationBatches.model, model), eq(generationBatches.provider, provider)),
          ),
        ),
        gte(asyncTasks.createdAt, threeDaysAgo),
        isNotNull(asyncTasks.duration),
      ),
    )
    .orderBy(asyncTasks.duration);

  // Rows are sorted by duration, so each group keeps ascending order for trimming.
  const samples = new Map<string, number[]>();
  for (const row of rows) {
    const key = getVideoLatencyKey(row);
    const group = samples.get(key);
    if (group) group.push(row.latency!);
    else samples.set(key, [row.latency!]);
  }

  return new Map(
    refs.map((ref) => {
      const key = getVideoLatencyKey(ref);
      return [key, trimmedAverage(samples.get(key) ?? [])];
    }),
  );
}

async function readCachedLatencies(
  redis: RedisClient,
  refs: VideoModelRef[],
): Promise<Map<string, number | null>> {
  const cached = new Map<string, number | null>();

  try {
    const values = await redis.mget(...refs.map(getCacheKey));
    values.forEach((value, index) => {
      if (value === null || value === undefined) return;
      cached.set(getVideoLatencyKey(refs[index]), value === 'null' ? null : Number(value));
    });
  } catch {
    // Cache read failed, fall through to the database
  }

  return cached;
}

async function writeCachedLatencies(
  redis: RedisClient,
  refs: VideoModelRef[],
  latencies: Map<string, number | null>,
) {
  await Promise.all(
    refs.map(async (ref) => {
      try {
        const latency = latencies.get(getVideoLatencyKey(ref));
        await redis.set(getCacheKey(ref), String(latency ?? 'null'), { ex: CACHE_TTL_SECONDS });
      } catch {
        // Cache write failed, ignore
      }
    }),
  );
}

/**
 * Returns the recent trimmed-average generation latency for each provider-scoped video model,
 * keyed by {@link getVideoLatencyKey}. Duplicate refs are collapsed, cached values come from one
 * Redis `MGET`, and all cache misses are resolved by a single database query.
 *
 * Never throws: a failed database lookup is logged with the affected models and reported as
 * `null`, because latency only feeds an optional progress estimate.
 */
export async function getVideoAvgLatencies(
  refs: VideoModelRef[],
): Promise<Map<string, number | null>> {
  const uniqueRefs = [...new Map(refs.map((ref) => [getVideoLatencyKey(ref), ref])).values()];
  const result = new Map<string, number | null>();
  if (uniqueRefs.length === 0) return result;

  let redis: RedisClient | null = null;
  try {
    redis = await getRedis();
  } catch {
    // Redis unavailable, fall through to direct query
  }

  if (redis) {
    for (const [key, latency] of await readCachedLatencies(redis, uniqueRefs)) {
      result.set(key, latency);
    }
  }

  const missingRefs = uniqueRefs.filter((ref) => !result.has(getVideoLatencyKey(ref)));
  if (missingRefs.length === 0) return result;

  try {
    const queried = await queryTrimmedAvgLatencies(missingRefs);
    for (const [key, latency] of queried) result.set(key, latency);
    if (redis) await writeCachedLatencies(redis, missingRefs, queried);
  } catch (error) {
    console.error(
      '[video] Failed to load average latency for %s:',
      formatModelRefs(missingRefs),
      error,
    );
    for (const ref of missingRefs) result.set(getVideoLatencyKey(ref), null);
  }

  return result;
}
