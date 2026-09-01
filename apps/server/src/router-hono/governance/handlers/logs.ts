import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { queryLogs } from '@/server/services/governance';

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

const parseDate = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * GET /api/governance/logs — paginated, filterable audit log for the admin
 * panel. Query params: `userId`, `executionTarget` (local|device|sandbox),
 * `blocked` (true|false), `from`/`to` (ISO 8601), `page`, `pageSize`.
 *
 * Not gated by `isGovernanceEnabled`: an admin reviewing history must still
 * be able to query rows written while the feature was previously on.
 */
export async function listLogs(c: Context): Promise<Response> {
  const query = c.req.query();

  const executionTarget = query.executionTarget as 'local' | 'device' | 'sandbox' | undefined;
  if (executionTarget && !['local', 'device', 'sandbox'].includes(executionTarget)) {
    return c.json({ error: 'Invalid executionTarget' }, 400);
  }

  const serverDB = await getServerDB();
  const result = await queryLogs(serverDB, {
    blocked: parseBoolean(query.blocked),
    executionTarget,
    from: parseDate(query.from),
    page: query.page ? Number(query.page) : undefined,
    pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    to: parseDate(query.to),
    userId: query.userId,
  });

  return c.json(result, 200);
}
