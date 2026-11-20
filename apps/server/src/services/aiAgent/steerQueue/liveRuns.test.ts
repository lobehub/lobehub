// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, threads, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findOwnLiveRunsInTopic, findTopicsRunByOthers } from './liveRuns';

/**
 * Retiring a conversation must account for runs in its threads too: an
 * "archive / delete all" that only looked at the main line would report
 * success while a thread run kept working in the retired conversation.
 */
describe('live runs across a whole topic', () => {
  let db: LobeChatDatabase;
  let me: string;
  let other: string;
  let topicId: string;
  let threadId: string;

  const run = (
    id: string,
    userId: string,
    extra: Partial<typeof agentOperations.$inferInsert> = {},
  ) => db.insert(agentOperations).values({ id, status: 'running', topicId, userId, ...extra });

  beforeEach(async () => {
    db = await getTestDB();
    me = randomUUID();
    other = randomUUID();
    topicId = `tpc_${randomUUID()}`;
    threadId = `thd_${randomUUID()}`;
    await db.insert(users).values([{ id: me }, { id: other }]);
    await db.insert(topics).values({ id: topicId, title: 't', userId: me });
    await db.insert(threads).values({
      id: threadId,
      sourceMessageId: 'm',
      title: 't',
      topicId,
      type: 'continuation',
      userId: me,
    });
  });

  afterEach(async () => {
    await db.delete(users).where(inArray(users.id, [me, other]));
  });

  it("lists the caller's live runs on the main line and in threads, not their children", async () => {
    await run('op_main', me);
    await run('op_thread', me, { threadId });
    await run('op_child', me, { parentOperationId: 'op_main' });
    await run('op_done', me, { status: 'done' });
    await run('op_theirs', other);

    const runs = await findOwnLiveRunsInTopic({ db }, { topicId, userId: me });
    expect(runs.map((item) => item.id).sort()).toEqual(['op_main', 'op_thread']);
    expect(runs.find((item) => item.id === 'op_thread')?.threadId).toBe(threadId);
  });

  it("sees another member's run inside a thread", async () => {
    await run('op_theirs_in_thread', other, { threadId });

    expect(await findTopicsRunByOthers({ db }, { topicIds: [topicId], userId: me })).toEqual([
      topicId,
    ]);
  });
});
