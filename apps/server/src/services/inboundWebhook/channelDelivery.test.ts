// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { MessageModel } from '@/database/models/message';
import { ChannelRepository } from '@/database/repositories/channel';
import {
  agentOperations,
  agents,
  channelJobs,
  channelMembers,
  channelMessages,
  channels,
  messages,
  topics,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import {
  assertChannelDelivery,
  ChannelDeliveryError,
  channelOriginOfRun,
  reportWebhookRunToChannel,
} from './channelDelivery';

/**
 * A webhook-woken run posts its answer to a Channel or Thread. Real: the models and Channel
 * repository on PGlite. Faked: the gateway nudge, and the key vault.
 */

const notified = vi.hoisted(() => [] as string[]);
vi.mock('@/server/services/channel/notify', () => ({
  notifyChannel: async (_db: unknown, channelId: string) => {
    notified.push(channelId);
  },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({
      decrypt: async (value: string) => ({ plaintext: value }),
      encrypt: async (value: string) => value,
    }),
  },
}));

const db: LobeChatDatabase = await getTestDB();

const userId = 'channel-delivery-user';
const agentId = 'channel-delivery-agent';
const topicId = 'tpc_channel_delivery';
let channelId = '';
let threadId = '';
let webhookId = '';

const repo = () => new ChannelRepository(db, userId);
const model = () =>
  new InboundWebhookModel(db, userId, undefined, {
    decrypt: async (value: string) => ({ plaintext: value }),
    encrypt: async (value: string) => value,
  });

const seedWebhook = async (threadTarget?: string) => {
  webhookId = (
    await model().create({
      agentId,
      config: {
        autoApprove: true,
        delivery: { channelId, ...(threadTarget && { threadId: threadTarget }) },
        topicMode: 'new',
      },
      kind: 'generic',
      name: 'CI',
      secret: 'token',
      status: 'active',
      verification: { scheme: 'bearer_token' },
    })
  ).id;
};

/** A finished run in its own topic whose last assistant message says `content`. */
const finishedRun = async (operationId: string, content: string, status = 'done') => {
  await db.insert(agentOperations).values({ agentId, id: operationId, status, topicId, userId });
  await db.insert(messages).values({
    agentId,
    content,
    metadata: { operationId },
    role: 'assistant',
    topicId,
    userId,
  });
};

const surface = (surfaceId: string, fallback: string) => ({
  catalogId: 'https://lobehub.com/a2ui/catalog/v1',
  fallback,
  operations: [{ createSurface: { surfaceId }, version: '1.0' }],
  surfaceId,
  version: '1.0',
});

/** A step of the run that drew a card, as the agent runtime writes it. */
const drawCard = async (operationId: string, card: ReturnType<typeof surface>) => {
  const messageModel = new MessageModel(db, userId);
  const step = await messageModel.create({
    content: '',
    metadata: { operationId },
    role: 'assistant',
    topicId,
  });
  await messageModel.create({
    content: 'Card drawn',
    parentId: step.id,
    plugin: { apiName: 'renderUI', arguments: '{}', identifier: 'lobe-a2ui', type: 'builtin' },
    pluginState: { surface: card },
    role: 'tool',
    tool_call_id: `call-${card.surfaceId}`,
    topicId,
  });
};

const agentPosts = () =>
  db
    .select()
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.agentId, agentId)));

beforeEach(async () => {
  notified.length = 0;
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, title: 'CI bot', userId });
  await db.insert(topics).values({ agentId, id: topicId, userId });
  const { channel } = await repo().create({ agentConfig: {}, agentId, title: 'CI bot' });
  channelId = channel.id;
  const root = await repo().send(channelId, {
    content: 'Watch the nightly build',
    requestKey: 'root',
    routing: 'fallback',
  });
  threadId = (await repo().createThread(channelId, { rootMessageId: root.id })).id;
});

afterEach(async () => {
  await db.delete(channelJobs);
  await db.delete(channels).where(eq(channels.id, channelId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('reportWebhookRunToChannel', () => {
  it("posts the run's answer into the webhook's Thread as the agent, once", async () => {
    await seedWebhook(threadId);
    await finishedRun('op_1', 'The nightly build failed in the e2e step.');

    expect(await reportWebhookRunToChannel(db, { operationId: 'op_1', webhookId })).toBe('posted');
    await reportWebhookRunToChannel(db, { operationId: 'op_1', webhookId });

    expect(await agentPosts()).toEqual([
      expect.objectContaining({
        content: 'The nightly build failed in the e2e step.',
        metadata: { operationId: 'op_1', source: 'inbound-webhook', topicId, webhookId },
        routingStatus: 'reply',
        threadId,
        userId: null,
      }),
    ]);
    expect(notified).toContain(channelId);
  });

  it('posts to the main timeline when the webhook names no Thread', async () => {
    await seedWebhook();
    await finishedRun('op_main', 'All green.');

    await reportWebhookRunToChannel(db, { operationId: 'op_main', webhookId });

    expect(await agentPosts()).toEqual([expect.objectContaining({ threadId: null })]);
  });

  it('posts the cards the run drew with its answer, like a published reply', async () => {
    await seedWebhook();
    const card = surface('build', 'Nightly build · e2e failed');
    await db
      .insert(agentOperations)
      .values({ agentId, id: 'op_card', status: 'done', topicId, userId });
    await drawCard('op_card', card);
    await db.insert(messages).values({
      agentId,
      content: 'Here is the build.',
      metadata: { operationId: 'op_card' },
      role: 'assistant',
      topicId,
      userId,
    });

    expect(await reportWebhookRunToChannel(db, { operationId: 'op_card', webhookId })).toBe(
      'posted',
    );

    expect(await agentPosts()).toEqual([
      expect.objectContaining({
        content: 'Here is the build.\n\n[Card] Nightly build · e2e failed',
        metadata: expect.objectContaining({
          source: 'inbound-webhook',
          surfaces: [card],
          surfacesBodyLength: 'Here is the build.'.length,
        }),
      }),
    ]);
  });

  it('posts a card-only answer instead of treating it as silence', async () => {
    await seedWebhook(threadId);
    const card = surface('status', 'All green');
    await db
      .insert(agentOperations)
      .values({ agentId, id: 'op_card_only', status: 'done', topicId, userId });
    await drawCard('op_card_only', card);

    expect(await reportWebhookRunToChannel(db, { operationId: 'op_card_only', webhookId })).toBe(
      'posted',
    );
    await reportWebhookRunToChannel(db, { operationId: 'op_card_only', webhookId });

    expect(await agentPosts()).toEqual([
      expect.objectContaining({
        content: '[Card] All green',
        metadata: expect.objectContaining({ surfaces: [card], surfacesBodyLength: 0 }),
        threadId,
      }),
    ]);
  });

  it('posts nothing for NO_REPLY or a run that has not finished', async () => {
    await seedWebhook();
    await finishedRun('op_silent', 'NO_REPLY');
    await finishedRun('op_running', 'Half way', 'running');

    expect(await reportWebhookRunToChannel(db, { operationId: 'op_silent', webhookId })).toBe(
      'silent',
    );
    expect(await reportWebhookRunToChannel(db, { operationId: 'op_running', webhookId })).toBe(
      'not-done',
    );
    expect(await agentPosts()).toEqual([]);
  });

  it('records channel_unavailable when the Channel refuses the post, and clears it after', async () => {
    await seedWebhook();
    await finishedRun('op_removed', 'Build failed.');
    const [member] = await db
      .select({ id: channelMembers.id })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.agentId, agentId)));
    // A direct conversation cannot mute its Agent; removing it is the same refusal.
    const setStatus = (status: 'active' | 'removed') =>
      db.update(channelMembers).set({ status }).where(eq(channelMembers.id, member.id));
    await setStatus('removed');

    expect(await reportWebhookRunToChannel(db, { operationId: 'op_removed', webhookId })).toBe(
      'unavailable',
    );
    expect((await model().findById(webhookId))?.lastError).toBe('channel_unavailable');

    await setStatus('active');
    await finishedRun('op_back', 'Build fixed.');
    expect(await reportWebhookRunToChannel(db, { operationId: 'op_back', webhookId })).toBe(
      'posted',
    );
    expect((await model().findById(webhookId))?.lastError).toBeNull();
  });
});

describe('assertChannelDelivery', () => {
  it('accepts a Channel and Thread the creator and the agent are in', async () => {
    expect(await assertChannelDelivery(db, { userId }, agentId, { channelId, threadId })).toEqual({
      channelId,
      threadId,
    });
  });

  it.each([
    ['a Channel the creator is not in', () => ({ scope: { userId: 'stranger' } })],
    ['an agent that is not a member', () => ({ agent: 'other-agent' })],
    ['a Thread of another Channel', () => ({ thread: 'cht_missing' })],
  ])('refuses %s', async (_label, patch) => {
    const {
      agent = agentId,
      scope = { userId },
      thread = threadId,
    } = patch() as {
      agent?: string;
      scope?: { userId: string };
      thread?: string;
    };
    await expect(
      assertChannelDelivery(db, scope, agent, { channelId, threadId: thread }),
    ).rejects.toBeInstanceOf(ChannelDeliveryError);
  });
});

describe('channelOriginOfRun', () => {
  it('is undefined for a run that is no Channel job', async () => {
    expect(await channelOriginOfRun(db, 'op_not_a_job')).toBeUndefined();
  });
});
