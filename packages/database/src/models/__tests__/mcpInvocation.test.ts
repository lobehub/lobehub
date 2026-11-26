// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, users } from '../../schemas';
import { McpInvocationModel } from '../mcpInvocation';

const db = await getTestDB();
const userId = 'mcp-recovery-fairness';
beforeEach(async () => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
});
afterAll(async () => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});
describe('durable MCP recovery fairness', () => {
  it('claims a disjoint bounded page across instances and rotates failed rows behind untouched work', async () => {
    const now = Date.now();
    await db.insert(agentOperations).values(
      Array.from({ length: 65 }, (_, index) => ({
        id: `mcp_client_fair_${index.toString().padStart(3, '0')}`,
        userId,
        status: 'waiting_for_client' as const,
        metadata: { clientMcpStep: { deadline: now - 61000, leaseUntil: 0 } },
      })),
    );
    // Unrelated operations, including another user's regular runtime, are not recovery candidates.
    await db
      .insert(agentOperations)
      .values({ id: 'ordinary-operation', userId, status: 'running', metadata: {} });
    const first = await McpInvocationModel.recoveryWork(db, now);
    const second = await McpInvocationModel.recoveryWork(db, now);
    expect(first.clients).toHaveLength(32);
    expect(second.clients).toHaveLength(32);
    expect(
      second.clients.some((row) =>
        first.clients.some((prior) => prior.operationId === row.operationId),
      ),
    ).toBe(false);
    // Simulate an entire first page failing, without changing their status or rows.
    const third = await McpInvocationModel.recoveryWork(db, now + 15001);
    expect(third.clients[0].operationId).toBe('mcp_client_fair_064');
    expect(third.clients).toHaveLength(32);
    expect(third.clients.some((row) => row.operationId === 'ordinary-operation')).toBe(false);
  });
  it('does not claim live renderer owners or a terminal operation', async () => {
    const now = Date.now();
    await db.insert(agentOperations).values([
      {
        id: 'mcp_client_live',
        userId,
        status: 'waiting_for_client',
        metadata: { clientMcpStep: { deadline: now - 61000, leaseUntil: now + 30000 } },
      },
      {
        id: 'mcp_client_stop',
        userId,
        status: 'interrupted',
        metadata: { clientMcpStep: { deadline: now - 61000, leaseUntil: 0 } },
      },
    ]);
    expect((await McpInvocationModel.recoveryWork(db, now)).clients).toHaveLength(0);
  });
});
