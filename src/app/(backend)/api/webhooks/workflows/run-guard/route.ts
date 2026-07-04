import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRedisConfig } from '@/envs/redis';
import { workflowClient } from '@/libs/qstash';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';
import { parseWorkflowRunGuardConfig } from '@/server/globalConfig/parseWorkflowRunGuardConfig';
import { cancelWorkflowRunsByGuardPolicy, setWorkflowRunGuard } from '@/server/workflows/runGuard';

// NOTICE:
// Next.js route segment config is required here because this operational webhook reads
// runtime env, Redis, and QStash clients. Keep it on Node.js and force dynamic handling so
// the route is evaluated per request instead of being statically optimized.
// Source/context: `https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config`
// and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md`.
export const runtime = 'nodejs';
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
  const { appUrl, webhook } = parseWorkflowRunGuardConfig();
  const headers = webhook.headers ?? {};

  if (Object.keys(headers).length === 0) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  for (const [key, value] of Object.entries(headers)) {
    if (request.headers.get(key) !== value) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = setGuardBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const redisConfig = getRedisConfig();
    if (!isRedisEnabled(redisConfig)) throw new Error('Redis is not configured');

    const redis = await initializeRedis(redisConfig);
    if (!redis) throw new Error('Redis is not configured');

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
