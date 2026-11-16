// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-webhook-thread-user';
const otherUserId = 'topic-webhook-thread-other';
const serverDB: LobeChatDatabase = await getTestDB();

const webhook = (webhookId: string, threadKey: string) => ({ webhook: { threadKey, webhookId } });

describe('TopicModel.findByWebhookThread', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await serverDB.insert(agents).values([
      { id: 'agent-a', userId },
      { id: 'agent-b', userId },
      { id: 'agent-other', userId: otherUserId },
    ]);
    await serverDB.insert(topics).values([
      {
        agentId: 'agent-a',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        id: 'older',
        metadata: webhook('wh-1', 'ticket-42'),
        userId,
      },
      {
        agentId: 'agent-a',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        id: 'newer',
        metadata: webhook('wh-1', 'ticket-42'),
        userId,
      },
      { agentId: 'agent-a', id: 'default-thread', metadata: webhook('wh-1', ''), userId },
      { agentId: 'agent-a', id: 'other-webhook', metadata: webhook('wh-2', 'ticket-42'), userId },
      { agentId: 'agent-b', id: 'other-agent', metadata: webhook('wh-1', 'ticket-7'), userId },
      {
        agentId: 'agent-other',
        id: 'other-user',
        metadata: webhook('wh-1', 'ticket-9'),
        userId: otherUserId,
      },
    ]);
  });

  const find = (params: { agentId: string; threadKey: string; webhookId: string }) =>
    new TopicModel(serverDB, userId).findByWebhookThread(params);

  it('returns the newest Topic of the same webhook and thread', async () => {
    const topic = await find({ agentId: 'agent-a', threadKey: 'ticket-42', webhookId: 'wh-1' });
    expect(topic?.id).toBe('newer');
  });

  it('keeps the empty default thread apart from named ones', async () => {
    const topic = await find({ agentId: 'agent-a', threadKey: '', webhookId: 'wh-1' });
    expect(topic?.id).toBe('default-thread');
  });

  it('matches neither another agent nor another user', async () => {
    await expect(
      find({ agentId: 'agent-a', threadKey: 'ticket-7', webhookId: 'wh-1' }),
    ).resolves.toBeUndefined();
    await expect(
      find({ agentId: 'agent-other', threadKey: 'ticket-9', webhookId: 'wh-1' }),
    ).resolves.toBeUndefined();
  });
});
