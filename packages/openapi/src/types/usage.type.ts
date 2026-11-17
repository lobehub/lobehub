import { z } from 'zod';

import type { OpenApiUsageSummary } from '@/business/server/openapiUsage';
import type {
  AgentUsageBucket,
  AgentUsageModelRow,
  AgentUsageStats,
} from '@/types/usage/usageRecord';

import { dateTimeSchema } from './common.type';

type ShapeOf<T> = Record<keyof T, z.ZodType>;

// ==================== Response Schemas ====================

const UsageQuotaSchema = z
  .object({
    /** The allowance for the cycle in USD; `null` when uncapped or unknown. */
    limit: z.number().nullable(),
    remaining: z.number().nullable(),
    /** Next reset of a recurring allowance; `null` when none recurs. */
    resetsAt: dateTimeSchema.nullable(),
    source: z.enum(['personal', 'workspace_pool', 'member_budget']),
    used: z.number(),
    /** `used / limit`, clamped to `0..1`; `null` when `limit` is. */
    usedRatio: z.number().nullable(),
  } satisfies ShapeOf<NonNullable<OpenApiUsageSummary['quota']>>)
  .strict();

/**
 * The caller's spend and allowance for the current window. Tied to
 * `OpenApiUsageSummary` so a field added to the summary fails type-checking
 * here instead of drifting out of the SDK.
 */
export const UsageSchema = z
  .object({
    /** `false` when the deployment has no metered budget provider. */
    available: z.boolean(),
    currency: z.literal('USD'),
    daily: z.array(z.object({ date: z.string(), value: z.number() }).strict()),
    period: z.object({ since: dateTimeSchema, until: dateTimeSchema }).strict(),
    /** `null` when the deployment has no metered budget provider. */
    quota: UsageQuotaSchema.nullable(),
    remainingBalance: z.number().nullable(),
    scope: z.enum(['personal', 'workspace']),
    spent: z.number(),
    usageByType: z.array(
      z
        .object({ count: z.number().int().nullable(), spend: z.number(), type: z.string() })
        .strict(),
    ),
  } satisfies ShapeOf<OpenApiUsageSummary>)
  .strict()
  .meta({ id: 'Usage' });

// ==================== Per-agent usage ====================

/** A calendar date (`2026-11-01`) or an ISO date-time. */
const usageBoundSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected a date or ISO date-time');

export const AgentUsageParamSchema = z.object({ agentId: z.string().min(1) });
export type AgentUsageParam = z.infer<typeof AgentUsageParamSchema>;

export const AgentUsageQuerySchema = z
  .object({
    /** Range end, inclusive. */
    endAt: usageBoundSchema,
    /** Bucket size of `buckets`: one per day or one per week. */
    granularity: z.enum(['day', 'week']).default('day'),
    /** Range start, inclusive. */
    startAt: usageBoundSchema,
  })
  .refine((query) => Date.parse(query.startAt) <= Date.parse(query.endAt), {
    message: '`startAt` must not be after `endAt`',
    path: ['startAt'],
  });
export type AgentUsageQuery = z.infer<typeof AgentUsageQuerySchema>;

const AgentUsageBucketSchema = z
  .object({
    cachedInputCost: z.number(),
    cachedInputTokens: z.number(),
    cacheWriteCost: z.number(),
    cacheWriteTokens: z.number(),
    /** Bucket start, epoch milliseconds. */
    date: z.number(),
    /** Uncached input cost (USD). */
    inputCost: z.number(),
    /** Uncached input tokens. */
    inputTokens: z.number(),
    /** Short display label of the bucket start, e.g. `5/25`. */
    label: z.string(),
    outputCost: z.number(),
    outputTokens: z.number(),
    totalCost: z.number(),
  } satisfies ShapeOf<AgentUsageBucket>)
  .strict();

const AgentUsageModelRowSchema = z
  .object({
    cost: z.number(),
    /** `provider/model`. */
    id: z.string(),
    model: z.string(),
    provider: z.string(),
    requests: z.number().int(),
    totalTokens: z.number(),
  } satisfies ShapeOf<AgentUsageModelRow>)
  .strict();

/**
 * One agent's spend and tokens over a range: a trend series, a per-model
 * breakdown and totals. Costs are in USD.
 */
export const AgentUsageStatsSchema = z
  .object({
    buckets: z.array(AgentUsageBucketSchema),
    byModel: z.array(AgentUsageModelRowSchema),
    summary: z
      .object({
        /** Cached share of input tokens, `0..1`. */
        cacheHitRate: z.number(),
        cacheReadTokens: z.number(),
        /** What cache hits saved compared with uncached input (USD). */
        cacheSavings: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalCost: z.number(),
        totalRequests: z.number().int(),
        totalTokens: z.number(),
      } satisfies ShapeOf<AgentUsageStats['summary']>)
      .strict(),
  } satisfies ShapeOf<AgentUsageStats>)
  .strict()
  .meta({ id: 'AgentUsageStats' });
