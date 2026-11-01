// @vitest-environment node
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, tasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-operation-cov-user';
const model = new AgentOperationModel(serverDB, userId);

/** Write a numeric `NaN` cost: Postgres numeric accepts it, and `sum()` over it stays NaN. */
const setNaNCost = (operationId: string) =>
  serverDB
    .update(agentOperations)
    .set({ totalCost: sql`'NaN'::numeric` })
    .where(eq(agentOperations.id, operationId));

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // `agent_operations.user_id` and `tasks.created_by_user_id` are cleaned explicitly.
  await serverDB.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await serverDB.delete(tasks).where(eq(tasks.createdByUserId, userId));
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('AgentOperationModel coverage', () => {
  it('treats a claimed redrive without a numeric attempt as not claimed', async () => {
    const operationId = 'op-cov-redrive-shape';
    await model.recordStart({ operationId });
    await serverDB
      .update(agentOperations)
      .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(agentOperations.id, operationId));
    // The UPDATE still runs for real; only the RETURNING metadata comes back without an attempt.
    const proxied = new AgentOperationModel(
      createProxyTestDB(serverDB, (query, result) =>
        query.startsWith('update') ? result.rows.map(() => [{ staleRedrive: {} }]) : result.rows,
      ),
      userId,
    );

    expect(await proxied.claimStaleRedrive(operationId, new Date(Date.now() - 60_000), 3)).toBe(
      null,
    );
    const [row] = await serverDB
      .select({ metadata: agentOperations.metadata })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId));
    expect(row.metadata).toMatchObject({ staleRedrive: { attempts: 1 } });
  });

  it('rolls a NaN child cost up as zero', async () => {
    await model.recordStart({ operationId: 'op-cov-parent' });
    await model.recordStart({ operationId: 'op-cov-child', parentOperationId: 'op-cov-parent' });
    await model.recordCompletion('op-cov-child', {
      completionReason: 'done',
      status: 'done',
      totalCost: 1,
    });
    await setNaNCost('op-cov-child');

    expect(await model.sumChildUsage('op-cov-parent')).toMatchObject({ totalCost: 0 });
  });

  it('sums a NaN task cost as zero', async () => {
    await serverDB.insert(tasks).values({
      createdByUserId: userId,
      id: 'task-cov-nan',
      identifier: 'T-COV-NAN',
      instruction: 'x',
      seq: 1,
    });
    await model.recordStart({ operationId: 'op-cov-task', taskId: 'task-cov-nan' });
    await setNaNCost('op-cov-task');

    expect(await model.sumCostByTask('task-cov-nan')).toBe(0);
  });

  it('reports a zero max duration when the aggregate yields no row', async () => {
    const proxied = new AgentOperationModel(
      createProxyTestDB(serverDB, () => []),
      userId,
    );

    expect(await proxied.getMaxDurationSeconds()).toBe(0);
  });
});
