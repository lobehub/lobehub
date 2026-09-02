import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import {
  deletePolicyForUser,
  getPolicyForUser,
  upsertPolicyForUser,
} from '@/server/services/governance';

const COMMAND_MODES = ['auto', 'host', 'sandbox'] as const;

const UpsertPolicyBodySchema = z.object({
  allowedNetworkDomains: z.array(z.string()).optional(),
  allowNetwork: z.boolean().optional(),
  commandMode: z.enum(COMMAND_MODES).optional(),
  createdBy: z.string().optional(),
  deniedReadRoots: z.array(z.string()).optional(),
  deniedWriteRoots: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  envAllowlist: z.array(z.string()).optional(),
  readableRoots: z.array(z.string()).optional(),
  writableRoots: z.array(z.string()).optional(),
});

/**
 * GET /api/governance/execution-policy/:userId — admin panel reads one
 * user's policy row to populate the edit form. `null` (not 404) when the
 * user has none yet — "no policy configured" is a normal, expected state,
 * not an error.
 */
export async function getExecutionPolicyByUserHandler(c: Context): Promise<Response> {
  const userId = c.req.param('userId');
  if (!userId) return c.json({ error: 'userId path param is required' }, 400);

  const serverDB = await getServerDB();
  const policy = await getPolicyForUser(serverDB, userId);

  return c.json({ policy: policy ?? null }, 200);
}

/**
 * PUT /api/governance/execution-policy/:userId — create or update the user's
 * policy row (upsert on the table's unique `userId`).
 */
export async function upsertExecutionPolicyHandler(c: Context): Promise<Response> {
  const userId = c.req.param('userId');
  if (!userId) return c.json({ error: 'userId path param is required' }, 400);

  let parsed;
  try {
    parsed = UpsertPolicyBodySchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  const serverDB = await getServerDB();
  const policy = await upsertPolicyForUser(serverDB, userId, parsed.data);

  return c.json({ policy }, 200);
}

/**
 * DELETE /api/governance/execution-policy/:userId — remove the policy row,
 * restoring the user to unrestricted (no row = no policy, same fail-open
 * default as an unconfigured user always had).
 */
export async function deleteExecutionPolicyHandler(c: Context): Promise<Response> {
  const userId = c.req.param('userId');
  if (!userId) return c.json({ error: 'userId path param is required' }, 400);

  const serverDB = await getServerDB();
  const deleted = await deletePolicyForUser(serverDB, userId);

  if (!deleted) return c.json({ error: 'Policy not found' }, 404);
  return c.json({ ok: true }, 200);
}
