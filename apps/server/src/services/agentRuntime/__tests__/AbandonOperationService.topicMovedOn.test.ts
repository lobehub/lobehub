// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, threads, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AbandonOperationService } from '../AbandonOperationService';

/**
 * The fallback failure row is anchored to the conversation tail, so it must
 * only be written while the tail still belongs to the abandoned run. These run
 * against a real database because the check is a single query whose subquery,
 * thread scoping and child exclusion are the whole point.
 */
describe('AbandonOperationService.topicMovedOn', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let topicId: string;

  const at = (iso: string) => new Date(iso);

  const seedOp = async (
    id: string,
    createdAt: string,
    extra: Partial<typeof agentOperations.$inferInsert> = {},
  ) =>
    serverDB.insert(agentOperations).values({
      createdAt: at(createdAt),
      id,
      status: 'running',
      topicId,
      userId,
      ...extra,
    });

  const movedOn = (operationId: string, origin: { threadId?: string } = {}) =>
    (
      new AbandonOperationService(serverDB, {
        coordinator: {} as any,
        snapshotStore: null,
      }) as any
    ).topicMovedOn(operationId, { topicId, userId, ...origin });

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = randomUUID();
    topicId = `tpc_${randomUUID()}`;
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(topics).values({ id: topicId, title: 't', userId });
  });

  afterEach(async () => {
    await serverDB.delete(agentOperations).where(eq(agentOperations.userId, userId));
    await serverDB.delete(users).where(eq(users.id, userId));
  });

  it('is false while the abandoned run is still the latest on the topic', async () => {
    await seedOp('op_old_first', '2026-09-01T00:00:00Z');
    await seedOp('op_stale', '2026-09-02T00:00:00Z');

    expect(await movedOn('op_stale')).toBe(false);
  });

  it('is true once a newer run started on the topic, even if it already finished', async () => {
    await seedOp('op_stale', '2026-09-02T00:00:00Z');
    await seedOp('op_newer', '2026-09-03T00:00:00Z', { status: 'done' });

    expect(await movedOn('op_stale')).toBe(true);
  });

  it("does not count the abandoned run's own sub-agent children", async () => {
    await seedOp('op_stale', '2026-09-02T00:00:00Z');
    await seedOp('op_child', '2026-09-02T00:01:00Z', { parentOperationId: 'op_stale' });

    expect(await movedOn('op_stale')).toBe(false);
  });

  it('scopes the check to the conversation the run belongs to', async () => {
    const threadId = `thd_${randomUUID()}`;
    await serverDB.insert(threads).values({
      id: threadId,
      sourceMessageId: 'm',
      title: 't',
      topicId,
      type: 'continuation',
      userId,
    });
    await seedOp('op_stale', '2026-09-02T00:00:00Z');
    // A newer run inside a thread does not own the main spine's tail.
    await seedOp('op_in_thread', '2026-09-03T00:00:00Z', { threadId });

    expect(await movedOn('op_stale')).toBe(false);
    await seedOp('op_stale_thread', '2026-09-01T00:00:00Z', { threadId });
    expect(await movedOn('op_stale_thread', { threadId })).toBe(true);
  });
});
