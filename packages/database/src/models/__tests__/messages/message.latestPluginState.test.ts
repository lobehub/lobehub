// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'latest-plugin-state-user';
const otherUserId = 'latest-plugin-state-other';
const messageModel = new MessageModel(serverDB, userId);

const identifier = 'lobe-group-agent-builder';

const seedToolCall = async (opts: {
  apiName?: string;
  createdAt: Date;
  id: string;
  ownerId?: string;
  state?: Record<string, unknown> | null;
  topicId: string;
}) => {
  const owner = opts.ownerId ?? userId;
  await serverDB.insert(messages).values({
    content: '',
    createdAt: opts.createdAt,
    id: opts.id,
    role: 'tool',
    topicId: opts.topicId,
    userId: owner,
  });
  await serverDB.insert(messagePlugins).values({
    apiName: opts.apiName ?? 'createGroup',
    id: opts.id,
    identifier,
    state: opts.state ?? null,
    toolCallId: `tc-${opts.id}`,
    userId: owner,
  });
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: 'lps-topic1', userId },
    { id: 'lps-topic2', userId },
    { id: 'lps-other-topic', userId: otherUserId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.findLatestPluginStateInTopic', () => {
  const query = (topicId: string) =>
    messageModel.findLatestPluginStateInTopic({ apiName: 'createGroup', identifier, topicId });

  it('returns the state of the newest call in the topic', async () => {
    await seedToolCall({
      createdAt: new Date('2026-09-25T06:16:24Z'),
      id: 'lps-a',
      state: { groupId: 'cg_first' },
      topicId: 'lps-topic1',
    });
    await seedToolCall({
      createdAt: new Date('2026-09-25T06:20:00Z'),
      id: 'lps-b',
      state: { groupId: 'cg_second' },
      topicId: 'lps-topic1',
    });

    expect(await query('lps-topic1')).toEqual({ groupId: 'cg_second' });
  });

  it('skips calls that produced no state (failed or aborted)', async () => {
    await seedToolCall({
      createdAt: new Date('2026-09-25T06:16:24Z'),
      id: 'lps-ok',
      state: { groupId: 'cg_ok' },
      topicId: 'lps-topic1',
    });
    await seedToolCall({
      createdAt: new Date('2026-09-25T06:17:00Z'),
      id: 'lps-aborted',
      state: null,
      topicId: 'lps-topic1',
    });

    expect(await query('lps-topic1')).toEqual({ groupId: 'cg_ok' });
  });

  it('only looks at the given topic, api and the caller’s own rows', async () => {
    await seedToolCall({
      apiName: 'updateGroup',
      createdAt: new Date('2026-09-25T06:16:24Z'),
      id: 'lps-other-api',
      state: { success: true },
      topicId: 'lps-topic1',
    });
    await seedToolCall({
      createdAt: new Date('2026-09-25T06:16:24Z'),
      id: 'lps-other-topic-call',
      state: { groupId: 'cg_elsewhere' },
      topicId: 'lps-topic2',
    });
    await seedToolCall({
      createdAt: new Date('2026-09-25T06:16:24Z'),
      id: 'lps-foreign',
      ownerId: otherUserId,
      state: { groupId: 'cg_foreign' },
      topicId: 'lps-other-topic',
    });

    expect(await query('lps-topic1')).toBeUndefined();
    expect(await query('lps-other-topic')).toBeUndefined();
  });
});
