// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-operation-prev-cost-user';
const otherUserId = 'agent-operation-prev-cost-other';
const topicId = 'tpc-prev-cost';
const model = new AgentOperationModel(serverDB, userId);

const insertOp = (
  id: string,
  values: Partial<typeof agentOperations.$inferInsert> & { startedAt: Date },
) =>
  serverDB.insert(agentOperations).values({
    id,
    provider: 'claude-code',
    status: 'done',
    topicId,
    userId,
    ...values,
  });

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  await serverDB
    .delete(agentOperations)
    .where(inArray(agentOperations.userId, [userId, otherUserId]));
  await serverDB.delete(topics).where(eq(topics.id, topicId));
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('AgentOperationModel.findPreviousCostedOnTopic', () => {
  it('returns the latest earlier costed op of the provider, with its raw session total', async () => {
    await insertOp('op-1', { startedAt: new Date('2026-11-01T00:00:00Z'), totalCost: 113.8 });
    await insertOp('op-2', {
      cost: { reportedSessionTotal: 115.71, total: 1.91 },
      startedAt: new Date('2026-11-02T00:00:00Z'),
      totalCost: 1.91,
    });
    // Skipped: zero cost, another provider, another user.
    await insertOp('op-zero', { startedAt: new Date('2026-11-03T00:00:00Z'), totalCost: 0 });
    await insertOp('op-codex', {
      provider: 'codex',
      startedAt: new Date('2026-11-03T01:00:00Z'),
      totalCost: 5,
    });
    await insertOp('op-other-user', {
      startedAt: new Date('2026-11-03T02:00:00Z'),
      totalCost: 9,
      userId: otherUserId,
    });
    await insertOp('op-current', { startedAt: new Date('2026-11-04T00:00:00Z'), totalCost: 139.6 });

    await expect(
      model.findPreviousCostedOnTopic({
        operationId: 'op-current',
        provider: 'claude-code',
        topicId,
      }),
    ).resolves.toEqual({ reportedSessionTotal: 115.71, totalCost: 1.91 });
  });

  it('ignores ops started after the finishing op and reports a plain cost as not de-cumulated', async () => {
    await insertOp('op-1', { startedAt: new Date('2026-11-01T00:00:00Z'), totalCost: 0.14 });
    await insertOp('op-current', { startedAt: new Date('2026-11-02T00:00:00Z') });
    await insertOp('op-later', { startedAt: new Date('2026-11-03T00:00:00Z'), totalCost: 7 });

    await expect(
      model.findPreviousCostedOnTopic({
        operationId: 'op-current',
        provider: 'claude-code',
        topicId,
      }),
    ).resolves.toEqual({ reportedSessionTotal: null, totalCost: 0.14 });
  });

  it('returns null when the topic has no earlier costed op', async () => {
    await insertOp('op-current', { startedAt: new Date('2026-11-02T00:00:00Z'), totalCost: 3 });

    await expect(
      model.findPreviousCostedOnTopic({
        operationId: 'op-current',
        provider: 'claude-code',
        topicId,
      }),
    ).resolves.toBeNull();
  });
});
