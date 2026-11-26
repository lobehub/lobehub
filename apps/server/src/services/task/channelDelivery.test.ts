// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { ChannelDeliveryError } from '@/server/services/inboundWebhook/channelDelivery';

import {
  normalizeTaskDeliveryConfig,
  postTaskRunToChannel,
  queueTaskDelivery,
  resolveTaskDeliveryInput,
  taskChannelDeliveryRun,
} from './channelDelivery';

/**
 * A task with a Channel delivery posts each run's answer (text and cards) there as its Agent.
 * Real: the models and Channel repository on PGlite. Faked: the gateway nudge.
 */

const notified = vi.hoisted(() => [] as string[]);
vi.mock('@/server/services/channel/notify', () => ({
  notifyChannel: async (_db: unknown, channelId: string) => {
    notified.push(channelId);
  },
}));

const db: LobeChatDatabase = await getTestDB();

const userId = 'task-channel-delivery-user';
const agentId = 'task-channel-delivery-agent';
const topicId = 'tpc_task_channel_delivery';
const scope = { userId };
let channelId = '';
let threadId = '';

const repo = () => new ChannelRepository(db, userId);
const card = {
  catalogId: 'https://lobehub.com/a2ui/catalog/v1',
  fallback: 'Daily report · all green',
  operations: [{ createSurface: { surfaceId: 'daily' }, version: '1.0' }],
  surfaceId: 'daily',
  version: '1.0',
};
const task = (delivery?: unknown) => ({
  config: { model: 'gpt', ...(delivery !== undefined && { delivery }) },
  id: 'task_1',
  identifier: 'T-1',
});

/** A finished task run in its own topic; `drawn` adds a card step before its final answer. */
const finishedRun = async (operationId: string, content: string | null, drawn = false) => {
  await db
    .insert(agentOperations)
    .values({ agentId, id: operationId, status: 'done', topicId, userId });
  const messageModel = new MessageModel(db, userId);
  if (drawn) {
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
      tool_call_id: `call-${operationId}`,
      topicId,
    });
  }
  if (content !== null)
    await db.insert(messages).values({
      agentId,
      content,
      metadata: { operationId },
      role: 'assistant',
      topicId,
      userId,
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
  await db.insert(agents).values({ id: agentId, title: 'Reporter', userId });
  await db.insert(topics).values({ agentId, id: topicId, userId });
  const { channel } = await repo().create({ agentConfig: {}, agentId, title: 'Reporter' });
  channelId = channel.id;
  const root = await repo().send(channelId, {
    content: 'Daily reports',
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

describe('postTaskRunToChannel', () => {
  it("posts the run's answer and its cards into the task's Thread, once per run", async () => {
    await finishedRun('op_1', 'Today went well.', true);
    const params = { operationId: 'op_1', scope, task: task({ channelId, threadId }) };

    expect(await postTaskRunToChannel(db, params)).toBe('posted');
    expect(await postTaskRunToChannel(db, params)).toBe('posted');

    expect(await agentPosts()).toEqual([
      expect.objectContaining({
        content: 'Today went well.\n\n[Card] Daily report · all green',
        metadata: expect.objectContaining({
          operationId: 'op_1',
          source: 'task',
          surfaces: [card],
          surfacesBodyLength: 'Today went well.'.length,
          taskId: 'task_1',
          taskIdentifier: 'T-1',
          topicId,
        }),
        routingStatus: 'reply',
        threadId,
        userId: null,
      }),
    ]);
    expect(notified).toContain(channelId);
  });

  it('posts a card-only answer to the main timeline', async () => {
    await finishedRun('op_card', null, true);

    expect(
      await postTaskRunToChannel(db, {
        operationId: 'op_card',
        scope,
        task: task({ channelId, threadId: null }),
      }),
    ).toBe('posted');
    expect(await agentPosts()).toEqual([
      expect.objectContaining({ content: '[Card] Daily report · all green', threadId: null }),
    ]);
  });

  it('posts nothing without a delivery, for NO_REPLY, or when the Agent left', async () => {
    await finishedRun('op_none', 'Hello');
    expect(await postTaskRunToChannel(db, { operationId: 'op_none', scope, task: task() })).toBe(
      'none',
    );
    await finishedRun('op_silent', 'NO_REPLY');
    expect(
      await postTaskRunToChannel(db, {
        operationId: 'op_silent',
        scope,
        task: task({ channelId }),
      }),
    ).toBe('silent');

    await db
      .update(channelMembers)
      .set({ status: 'removed' })
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.agentId, agentId)));
    await finishedRun('op_gone', 'Report');
    expect(
      await postTaskRunToChannel(db, { operationId: 'op_gone', scope, task: task({ channelId }) }),
    ).toBe('unavailable');
    expect(await agentPosts()).toEqual([]);
  });
});

describe('Channel delivery config', () => {
  it('stores a checked delivery with an explicit null Thread, and lets null clear it', async () => {
    expect(
      await normalizeTaskDeliveryConfig(db, scope, agentId, {
        delivery: { channelId },
        model: 'x',
      }),
    ).toEqual({ delivery: { channelId, threadId: null }, model: 'x' });
    expect(await normalizeTaskDeliveryConfig(db, scope, agentId, { delivery: null })).toEqual({
      delivery: null,
    });
    expect(await normalizeTaskDeliveryConfig(db, scope, null, { model: 'x' })).toEqual({
      model: 'x',
    });
  });

  it.each([
    ['no channelId', agentId, { threadId }],
    ['no Agent on the task', null, { channelId }],
    ['an Agent that is not a member', 'other-agent', { channelId }],
    ['a Thread of another Channel', agentId, { channelId, threadId: 'cht_missing' }],
  ])('refuses %s', async (_label, agent, delivery) => {
    await expect(
      normalizeTaskDeliveryConfig(db, scope, agent, { delivery }),
    ).rejects.toBeInstanceOf(ChannelDeliveryError);
  });

  it('resolves {} to where the asking run answers, and explicit ids as given', async () => {
    expect(await resolveTaskDeliveryInput(db, undefined, { channelId, threadId })).toEqual({
      channelId,
      threadId,
    });
    expect(await resolveTaskDeliveryInput(db, undefined, null)).toBeNull();
    await expect(resolveTaskDeliveryInput(db, 'op_not_a_job', {})).rejects.toBeInstanceOf(
      ChannelDeliveryError,
    );
  });

  it('queues the write through updateConfig, or says why it was refused', async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const ops: Promise<unknown>[] = [];
    const changes: string[] = [];
    const deps = { db, taskCaller: { updateConfig }, userId };
    const target = { assigneeAgentId: agentId, id: 'task_1' };

    expect(await queueTaskDelivery(deps, target, { channelId }, ops, changes)).toBeUndefined();
    expect(updateConfig).toHaveBeenCalledWith({
      config: { delivery: { channelId, threadId: null } },
      id: 'task_1',
    });
    expect(changes).toEqual([`results post to Channel ${channelId} (main timeline)`]);

    expect(
      await queueTaskDelivery(deps, { ...target, assigneeAgentId: null }, { channelId }, ops, []),
    ).toContain('Assign the task to an Agent');
    expect(await queueTaskDelivery(deps, target, undefined, ops, [])).toBeUndefined();
    expect(updateConfig).toHaveBeenCalledOnce();
  });

  it('gives a delivering run the card tool and the delivery instruction', () => {
    expect(taskChannelDeliveryRun({ delivery: { channelId } })).toEqual({
      additionalPluginIds: ['lobe-a2ui'],
      instructions: expect.stringContaining('posted as your message in the Channel'),
    });
    expect(taskChannelDeliveryRun({ delivery: null })).toBeUndefined();
  });
});
