import { z } from 'zod';

import type { OpenApiUsageSummary } from '@/business/server/openapiUsage';

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
