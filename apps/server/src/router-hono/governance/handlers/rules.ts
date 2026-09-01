import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { createRule, deleteRule, listRulesForUser, updateRule } from '@/server/services/governance';

const PATTERN_TYPES = ['exact', 'prefix', 'regex'] as const;
const SCOPES = ['all', 'local', 'device', 'sandbox'] as const;

const CreateRuleBodySchema = z.object({
  action: z.string().optional(),
  createdBy: z.string().optional(),
  enabled: z.boolean().optional(),
  pattern: z.string().min(1),
  patternType: z.enum(PATTERN_TYPES),
  scope: z.enum(SCOPES),
  userId: z.string().min(1),
});

const UpdateRuleBodySchema = z.object({
  action: z.string().optional(),
  enabled: z.boolean().optional(),
  pattern: z.string().min(1).optional(),
  patternType: z.enum(PATTERN_TYPES).optional(),
  scope: z.enum(SCOPES).optional(),
});

/**
 * GET /api/governance/rules?userId=<id> — list a user's rules for the admin
 * panel's rule table. Not gated by `isGovernanceEnabled`: an admin must be
 * able to author rules before flipping the flag on.
 */
export async function listRules(c: Context): Promise<Response> {
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId query param is required' }, 400);

  const serverDB = await getServerDB();
  const rules = await listRulesForUser(serverDB, userId);

  return c.json({ rules }, 200);
}

/** POST /api/governance/rules — create a rule. */
export async function createRuleHandler(c: Context): Promise<Response> {
  let parsed;
  try {
    parsed = CreateRuleBodySchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  const serverDB = await getServerDB();
  const rule = await createRule(serverDB, parsed.data);

  return c.json({ rule }, 201);
}

/** PUT /api/governance/rules/:id — update a rule (including enable/disable). */
export async function updateRuleHandler(c: Context): Promise<Response> {
  const id = c.req.param('id');

  let parsed;
  try {
    parsed = UpdateRuleBodySchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  const serverDB = await getServerDB();
  const rule = await updateRule(serverDB, id, parsed.data);

  if (!rule) return c.json({ error: 'Rule not found' }, 404);
  return c.json({ rule }, 200);
}

/** DELETE /api/governance/rules/:id */
export async function deleteRuleHandler(c: Context): Promise<Response> {
  const id = c.req.param('id');

  const serverDB = await getServerDB();
  const deleted = await deleteRule(serverDB, id);

  if (!deleted) return c.json({ error: 'Rule not found' }, 404);
  return c.json({ ok: true }, 200);
}
