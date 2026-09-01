import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { isGovernanceEnabled, logCommandExecution } from '@/server/services/governance';

const LogBodySchema = z.object({
  apiName: z.string().min(1),
  commandText: z.string(),
  deviceId: z.string().optional(),
  executionTarget: z.enum(['local', 'device', 'sandbox']),
  outcome: z.object({
    blocked: z.boolean(),
    durationMs: z.number().int().nonnegative().optional(),
    errorMessage: z.string().optional(),
    matchedRuleId: z.string().optional(),
    success: z.boolean().optional(),
  }),
  toolIdentifier: z.string().min(1),
  userId: z.string().min(1),
});

/**
 * POST /api/governance/log — the sandbox execution service reports the
 * outcome of a command it ran (or blocked) so the audit trail covers
 * execution that happens entirely outside this process.
 *
 * No response body (`204`) — this is a fire-and-forget write, same shape as
 * `POST /api/agent/tool-result`. No-ops (still `204`) when governance is
 * disabled, matching `logCommandExecution`'s own short-circuit.
 */
export async function log(c: Context): Promise<Response> {
  let parsed;
  try {
    parsed = LogBodySchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  if (!isGovernanceEnabled()) {
    return c.body(null, 204);
  }

  const { outcome, ...ctx } = parsed.data;
  const serverDB = await getServerDB();
  await logCommandExecution(ctx, outcome, serverDB);

  return c.body(null, 204);
}
