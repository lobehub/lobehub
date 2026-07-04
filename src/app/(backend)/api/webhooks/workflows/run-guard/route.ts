import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRedisConfig } from '@/envs/redis';
import { workflowClient } from '@/libs/qstash';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';
import type { BaseRedisProvider } from '@/libs/redis/types';
import { cancelWorkflowRunsByGuardPolicy, setWorkflowRunGuard } from '@/server/workflows/runGuard';

/**
 * Forces this operational webhook to run on Node.js for Redis and QStash clients.
 */
export const runtime = 'nodejs';

/**
 * Disables static optimization for an operational webhook that reads runtime env and Redis.
 */
export const dynamic = 'force-dynamic';

const guardScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }),
  z.object({ type: z.literal('path'), workflowPath: z.string().trim().min(1) }),
  z.object({ type: z.literal('user'), userId: z.string().trim().min(1) }),
  z.object({ type: z.literal('run'), workflowRunId: z.string().trim().min(1) }),
  z.object({
    stepName: z.string().trim().min(1),
    type: z.literal('step'),
    workflowRunId: z.string().trim().min(1),
  }),
]);

const guardPolicySchema = z
  .object({
    cancelQstash: z.boolean().optional(),
  })
  .strict();

const setGuardBodySchema = z
  .object({
    policy: guardPolicySchema.optional(),
    reason: z.string().trim().min(1).optional(),
    scope: guardScopeSchema,
    ttlSeconds: z.number().int().positive().optional(),
  })
  .strict();

/**
 * Parses required run-guard webhook headers from environment configuration.
 *
 * Use when:
 * - Matching the memory webhook `Header=Value,Header2=Value2` configuration shape.
 * - Keeping run-guard webhook authorization configurable by deployment.
 *
 * Expects:
 * - Header pairs are comma-separated.
 * - Each pair contains the first `=` between the header name and value.
 *
 * Returns:
 * - A header map used for exact request header checks.
 */
const parseWebhookHeaders = () =>
  process.env.WORKFLOW_RUN_GUARD_WEBHOOK_HEADERS?.split(',')
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex <= 0) return acc;

      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {}) ?? {};

/**
 * Verifies the workflow run guard webhook header before mutating guard state.
 *
 * Use when:
 * - Protecting the external workflow run guard webhook.
 * - Missing configuration should deny access instead of opening the route.
 *
 * Expects:
 * - `WORKFLOW_RUN_GUARD_WEBHOOK_HEADERS` is set in operational environments.
 *
 * Returns:
 * - An unauthorized response when the request cannot be authenticated.
 */
const requireWebhookAuth = (request: Request): NextResponse | undefined => {
  const headers = parseWebhookHeaders();

  if (Object.keys(headers).length === 0) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  for (const [key, value] of Object.entries(headers)) {
    if (request.headers.get(key) !== value) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
};

/**
 * Reads the shared Redis client and fails closed for webhook guard mutations.
 *
 * Use when:
 * - Setting workflow run guards from the webhook route.
 *
 * Expects:
 * - Redis is configured when this webhook is enabled.
 *
 * Returns:
 * - A non-null Redis provider compatible with the shared guard store.
 */
const getRedisOrThrow = async (): Promise<BaseRedisProvider> => {
  const config = getRedisConfig();
  if (!isRedisEnabled(config)) throw new Error('Redis is not configured');

  return initializeRedis(config);
};

const invalidRequest = (issues: z.ZodIssue[]) =>
  NextResponse.json({ error: 'Invalid request', issues }, { status: 400 });

const invalidJson = () => NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

const resolveAppUrl = () =>
  process.env.MEMORY_USER_MEMORY_WEBHOOK_BASE_URL ||
  process.env.INTERNAL_APP_URL ||
  process.env.APP_URL;

/**
 * Creates or replaces one workflow run guard from an authenticated webhook.
 *
 * Use when:
 * - External automation needs to stop workflow work by global, path, user, run, or step scope.
 * - Path-scoped guards may also cancel matching active QStash workflow runs.
 *
 * Expects:
 * - The configured webhook headers match the request headers.
 * - Body matches the mutation schema.
 * - Redis is configured.
 *
 * Returns:
 * - JSON containing `success: true`, the stored guard, and optional QStash cancellation result.
 */
export const POST = async (request: Request) => {
  const unauthorized = requireWebhookAuth(request);
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJson();
  }

  const parsed = setGuardBodySchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error.issues);

  try {
    const redis = await getRedisOrThrow();
    const { policy, reason, scope, ttlSeconds } = parsed.data;
    const guard = await setWorkflowRunGuard(redis, {
      scope,
      ttlSeconds,
      value: {
        policy,
        reason,
      },
    });

    let qstash;

    if (policy?.cancelQstash && scope.type === 'path') {
      const appUrl = resolveAppUrl();
      if (!appUrl) throw new Error('App URL is not configured');

      qstash = await cancelWorkflowRunsByGuardPolicy(workflowClient, {
        appUrl,
        workflowPath: scope.workflowPath,
      });
    }

    return NextResponse.json({ guard, qstash, success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
