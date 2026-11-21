// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { messages, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_AGENT_RELAY_HOPS } from '@/server/services/aiAgent/sourceAttribution';

import { listReceiptsSince } from './receipt';

/**
 * The no-Redis catch-up wakes the opener for receipts that landed while it
 * ran. It must respect the same relay bound as the direct wake, or a receipt
 * written "for a person to see" would start a model run after all.
 */
describe('listReceiptsSince', () => {
  let db: LobeChatDatabase;
  let userId: string;
  let topicId: string;
  const since = new Date('2026-11-20T00:00:00.000Z');

  const receipt = (id: string, hop: number | undefined, createdAt = '2026-11-20T00:01:00.000Z') =>
    db.insert(messages).values({
      content: 'reply',
      createdAt: new Date(createdAt),
      id,
      metadata: hop === undefined ? {} : { agentSender: { agentId: 'agt_c', hop } },
      role: 'user',
      topicId,
      userId,
    });

  beforeEach(async () => {
    db = await getTestDB();
    userId = randomUUID();
    topicId = `tpc_${randomUUID()}`;
    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'parent', userId });
  });

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  it('returns the receipts since the run started that may still wake the opener', async () => {
    await receipt('subtopic-cb-within', MAX_AGENT_RELAY_HOPS);
    await receipt('subtopic-cb-no-hop', undefined);
    await receipt('subtopic-cb-over', MAX_AGENT_RELAY_HOPS + 1);
    await receipt('subtopic-cb-before', 1, '2026-11-19T23:59:00.000Z');
    await receipt('msg-not-a-receipt', 1);

    expect((await listReceiptsSince(db, topicId, since)).sort()).toEqual([
      'subtopic-cb-no-hop',
      'subtopic-cb-within',
    ]);
  });
});
