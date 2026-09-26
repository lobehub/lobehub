// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messagePlugins, messages, threads, topics, users } from '../../../schemas';
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
  threadId?: string;
  topicId: string;
}) => {
  const owner = opts.ownerId ?? userId;
  await serverDB.insert(messages).values({
    content: '',
    createdAt: opts.createdAt,
    id: opts.id,
    role: 'tool',
    threadId: opts.threadId,
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

describe('MessageModel.findLatestPluginStateInTopic thread scoping', () => {
  const query = (threadId?: string | null) =>
    messageModel.findLatestPluginStateInTopic({
      apiName: 'createGroup',
      identifier,
      threadId,
      topicId: 'lps-topic1',
    });

  // Main conversation made cg_main; a later branch thread made cg_branch.
  beforeEach(async () => {
    await seedToolCall({
      createdAt: new Date('2026-09-25T06:00:00Z'),
      id: 'lps-main',
      state: { groupId: 'cg_main' },
      topicId: 'lps-topic1',
    });
    await serverDB.insert(threads).values([
      {
        id: 'lps-thread-branch',
        sourceMessageId: 'lps-main',
        topicId: 'lps-topic1',
        type: 'continuation',
        userId,
      },
      {
        id: 'lps-thread-sibling',
        sourceMessageId: 'lps-main',
        topicId: 'lps-topic1',
        type: 'continuation',
        userId,
      },
      {
        id: 'lps-thread-isolated',
        sourceMessageId: 'lps-main',
        topicId: 'lps-topic1',
        type: 'isolation',
        userId,
      },
    ]);
    await seedToolCall({
      createdAt: new Date('2026-09-25T06:10:00Z'),
      id: 'lps-branch',
      state: { groupId: 'cg_branch' },
      threadId: 'lps-thread-branch',
      topicId: 'lps-topic1',
    });
  });

  it('keeps a group created in a thread out of the main conversation', async () => {
    expect(await query()).toEqual({ groupId: 'cg_main' });
    expect(await query(null)).toEqual({ groupId: 'cg_main' });
  });

  it('keeps a group created in a thread out of its sibling threads', async () => {
    // A continuation sibling still inherits the main conversation up to its source.
    expect(await query('lps-thread-sibling')).toEqual({ groupId: 'cg_main' });
    // An isolated thread inherits nothing.
    expect(await query('lps-thread-isolated')).toBeUndefined();
  });

  it('sees the thread’s own call first, then its inherited ancestors', async () => {
    expect(await query('lps-thread-branch')).toEqual({ groupId: 'cg_branch' });
  });
});
