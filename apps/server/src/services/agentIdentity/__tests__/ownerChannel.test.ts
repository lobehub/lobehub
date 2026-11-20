// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAccountModel } from '@/database/models/agentAccount';
import { ChannelRepository } from '@/database/repositories/channel';
import {
  agentAccounts,
  agentOperations,
  agents,
  channelJobs,
  channelMessages,
  channels,
  messages,
  topics,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { reportRunToOwnerChannel } from '../ownerChannel';

/**
 * A mail-woken run reports to its owner's direct Channel. Real: the models and Channel repository
 * on PGlite. Faked: the gateway nudge that tells open clients to refresh.
 */

const notified = vi.hoisted(() => [] as string[]);
vi.mock('@/server/services/channel/notify', () => ({
  notifyChannel: async (_db: unknown, channelId: string) => {
    notified.push(channelId);
  },
}));

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'owner-channel-user';
const agentId = 'owner-channel-agent';
const topicId = 'tpc_owner_channel';
let accountId = '';
let channelId = '';

/** A finished run in its own topic whose last assistant message says `content`. */
const finishedRun = async (operationId: string, content: string, status = 'done') => {
  await serverDB
    .insert(agentOperations)
    .values({ agentId, id: operationId, status, topicId, userId });
  await serverDB.insert(messages).values({
    agentId,
    content,
    metadata: { operationId },
    role: 'assistant',
    topicId,
    userId,
  });
};

const channelPosts = () =>
  serverDB.select().from(channelMessages).where(eq(channelMessages.channelId, channelId));

beforeEach(async () => {
  notified.length = 0;
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, title: '邮件秘书', userId });
  await serverDB.insert(topics).values({ agentId, id: topicId, userId });
  accountId = (
    await new AgentAccountModel(serverDB, userId).create({
      agentId,
      capabilities: { receive: true, send: true },
      identifier: 'secretary@lobe.id',
      kind: 'mail',
      provider: 'agent-mail',
    })
  ).id;
  const { channel } = await new ChannelRepository(serverDB, userId).create({
    agentConfig: {},
    agentId,
    title: '邮件秘书',
  });
  channelId = channel.id;
});

afterEach(async () => {
  await serverDB.delete(channelJobs);
  await serverDB.delete(channels);
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
});

describe('reportRunToOwnerChannel', () => {
  it("posts the run's final answer to the direct Channel as the agent, once", async () => {
    await finishedRun('op_report', '有 1 件需要你处理：David 回复了外链合作，问你是否同意。');

    expect(await reportRunToOwnerChannel(serverDB, { accountId, operationId: 'op_report' })).toBe(
      'posted',
    );
    // A redelivered completion posts nothing new.
    await reportRunToOwnerChannel(serverDB, { accountId, operationId: 'op_report' });

    expect(await channelPosts()).toEqual([
      expect.objectContaining({
        agentId,
        content: '有 1 件需要你处理：David 回复了外链合作，问你是否同意。',
        metadata: {
          accountId,
          operationId: 'op_report',
          source: 'agent-inbox',
          topicId,
        },
        replyToId: null,
        routingStatus: 'reply',
        userId: null,
      }),
    ]);
    expect(notified).toContain(channelId);
    // The post wakes no Agent: nobody asked it anything.
    expect(await serverDB.select().from(channelJobs)).toEqual([]);
  });

  it('posts nothing when the agent chose silence', async () => {
    await finishedRun('op_silent', 'NO_REPLY');

    expect(await reportRunToOwnerChannel(serverDB, { accountId, operationId: 'op_silent' })).toBe(
      'silent',
    );
    expect(await channelPosts()).toEqual([]);
  });

  it('posts nothing for a run that has not finished', async () => {
    await finishedRun('op_running', 'half a thought', 'running');

    expect(await reportRunToOwnerChannel(serverDB, { accountId, operationId: 'op_running' })).toBe(
      'not-done',
    );
    expect(await channelPosts()).toEqual([]);
  });

  it('leaves a direct Channel the owner moved to the trash alone', async () => {
    await new ChannelRepository(serverDB, userId).remove(channelId);
    await finishedRun('op_trashed', 'Something for you.');

    expect(await reportRunToOwnerChannel(serverDB, { accountId, operationId: 'op_trashed' })).toBe(
      'no-channel',
    );
    expect(await channelPosts()).toEqual([]);
  });

  it('ignores an account that no longer exists', async () => {
    await expect(
      reportRunToOwnerChannel(serverDB, {
        accountId: '00000000-0000-0000-0000-000000000000',
        operationId: 'op_any',
      }),
    ).resolves.toBe('no-account');
  });
});
