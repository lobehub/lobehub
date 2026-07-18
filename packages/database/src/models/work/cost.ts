import { inArray } from 'drizzle-orm';

import { workVersions } from '../../schemas/work';
import type { WorkContext } from './context';

/**
 * `cumulativeCost` is a running snapshot of the whole operation's spend at
 * the time each version was written (see schemas/work.ts), not a per-version
 * delta — so versions produced by the same root operation must not be added
 * together (v2 already contains v1's spend). Take MAX per operation, then
 * sum across operations. Versions without a rootOperationId are treated as
 * independent operations.
 */
export const getTotalCostByWorkIds = async (ctx: WorkContext, workIds: string[]) => {
  const ids = Array.from(new Set(workIds));
  const result = new Map<string, number | null>();
  if (ids.length === 0) return result;

  const rows = await ctx.db
    .select({
      cumulativeCost: workVersions.cumulativeCost,
      rootOperationId: workVersions.rootOperationId,
      versionId: workVersions.id,
      workId: workVersions.workId,
    })
    .from(workVersions)
    .where(inArray(workVersions.workId, ids));

  const maxCostByOperation = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.cumulativeCost === null) continue;

    const operationKey = row.rootOperationId ?? row.versionId;
    const operations = maxCostByOperation.get(row.workId) ?? new Map<string, number>();
    operations.set(operationKey, Math.max(operations.get(operationKey) ?? 0, row.cumulativeCost));
    maxCostByOperation.set(row.workId, operations);
  }

  for (const [workId, operations] of maxCostByOperation) {
    let totalCost = 0;
    for (const cost of operations.values()) totalCost += cost;
    result.set(workId, totalCost);
  }

  return result;
};
