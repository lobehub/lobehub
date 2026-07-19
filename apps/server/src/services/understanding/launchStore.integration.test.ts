// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, threads, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { ThreadType } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUnderstandingLaunchStore } from './launchStore';

const db: LobeChatDatabase = await getTestDB();
const userId = 'understanding-launch-user';
const agentId = 'understanding-launch-agent';
const topicId = 'understanding-launch-topic';
const threadId = 'understanding-launch-thread';
const identity = { agentId, kind: 'source' as const, threadId, topicId };

describe('UnderstandingLaunchStore claim', () => {
  beforeEach(async () => {
    await db.delete(users).where(inArray(users.id, [userId]));
    await db.insert(users).values({ id: userId });
    await db.insert(agents).values({ id: agentId, userId });
    await db.insert(topics).values({ agentId, id: topicId, userId });
    await db.insert(threads).values({
      agentId,
      id: threadId,
      metadata: { onboardingUnderstanding: { kind: 'source' } },
      topicId,
      type: ThreadType.Isolation,
      userId,
    });
  });

  afterEach(async () => {
    await db.delete(users).where(inArray(users.id, [userId]));
  });

  it('atomically claims one launch pair across concurrent store instances', async () => {
    const first = { assistantMessageId: 'assistant-first', operationId: 'operation-first' };
    const second = { assistantMessageId: 'assistant-second', operationId: 'operation-second' };

    const claimed = await Promise.all([
      createUnderstandingLaunchStore(db, userId).save(identity, first),
      createUnderstandingLaunchStore(db, userId).save(identity, second),
    ]);

    expect(claimed[0]).toEqual(claimed[1]);
    expect([first, second]).toContainEqual(claimed[0]);
    await expect(createUnderstandingLaunchStore(db, userId).find(identity)).resolves.toEqual(
      claimed[0],
    );
  });
});
