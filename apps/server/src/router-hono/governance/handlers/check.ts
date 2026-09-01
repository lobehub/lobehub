import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { checkCommand, isGovernanceEnabled } from '@/server/services/governance';

const CheckBodySchema = z.object({
  apiName: z.string().min(1),
  commandText: z.string(),
  deviceId: z.string().optional(),
  executionTarget: z.enum(['local', 'device', 'sandbox']),
  toolIdentifier: z.string().min(1),
  userId: z.string().min(1),
});

/**
 * POST /api/governance/check — the sandbox execution service (and any other
 * non-CPC-server dispatcher) calls this before running a command it received,
 * so a governance rule applies uniformly regardless of which process actually
 * spawns the shell.
 *
 * Response: `{ allowed: boolean, ruleId?: string }`.
 *
 * Delegates entirely to `checkCommand`, which already short-circuits to
 * `{ allowed: true }` when governance is disabled and fails open on any
 * internal error — this handler adds no additional logic on top.
 */
export async function check(c: Context): Promise<Response> {
  let parsed;
  try {
    parsed = CheckBodySchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  // Mirror the in-process chokepoint's short-circuit: no DB connection is
  // opened at all when the feature is off, even though a caller may hit this
  // endpoint unconditionally for every command it dispatches.
  if (!isGovernanceEnabled()) {
    return c.json({ allowed: true }, 200);
  }

  const serverDB = await getServerDB();
  const decision = await checkCommand(parsed.data, serverDB);

  return c.json(decision, 200);
}
