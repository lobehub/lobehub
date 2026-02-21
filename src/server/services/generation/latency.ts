import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';

import { asyncTasks, generationBatches, generations } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled, type RedisClient } from '@/libs/redis';

const CACHE_KEY_PREFIX = 'video:avg_latency';
const CACHE_TTL_SECONDS = 300; // 5 minutes

/** Trim ratio: remove top/bottom 10% of samples before averaging */
const TRIM_RATIO = 0.1;

async function getRedis(): Promise<RedisClient | null> {
  const config = getRedisConfig();
  if (!isRedisEnabled(config)) return null;

  return initializeRedis(config);
}

function getCacheKey(model: string): string {
  return `${CACHE_KEY_PREFIX}:${model}`;
}

async function queryTrimmedAvgLatency(model: string): Promise<number | null> {
  const db = await getServerDB();

  const threeDaysAgo = sql`NOW() - INTERVAL '3 days'`;

  const rows = await db
    .select({ latency: asyncTasks.duration })
    .from(asyncTasks)
    .innerJoin(generations, eq(generations.asyncTaskId, asyncTasks.id))
    .innerJoin(generationBatches, eq(generations.generationBatchId, generationBatches.id))
    .where(
      and(
        eq(asyncTasks.type, AsyncTaskType.VideoGeneration),
        eq(asyncTasks.status, AsyncTaskStatus.Success),
        eq(generationBatches.model, model),
        gte(asyncTasks.createdAt, threeDaysAgo),
        isNotNull(asyncTasks.duration),
      ),
    )
    .orderBy(asyncTasks.duration);

  if (rows.length === 0) return null;

  const latencies = rows.map((r) => r.latency!);

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

export async function getVideoAvgLatency(model: string): Promise<number | null> {
  let redis: RedisClient | null = null;

  try {
    redis = await getRedis();
  } catch {
    // Redis unavailable, fall through to direct query
  }

  const cacheKey = getCacheKey(model);

  // Try cache first
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null && cached !== undefined) {
        return cached === 'null' ? null : Number(cached);
      }
    } catch {
      // Cache read failed, fall through
    }
  }

  const avgLatency = await queryTrimmedAvgLatency(model);

  // Write back to cache
  if (redis) {
    try {
      await redis.set(cacheKey, String(avgLatency ?? 'null'), { ex: CACHE_TTL_SECONDS });
    } catch {
      // Cache write failed, ignore
    }
  }

  return avgLatency;
}
