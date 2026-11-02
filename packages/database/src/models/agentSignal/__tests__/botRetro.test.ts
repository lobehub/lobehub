// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  messagePlugins,
  messages,
  signalDecisionLabels,
  signalDecisions,
  signals,
  topics,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { createProxyTestDB } from '../../__tests__/_proxyTestDB';
import { AgentBotRetroModel } from '../botRetro';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'bot-retro-user';
const otherUserId = 'bot-retro-other-user';
const agentId = 'bot-retro-agent';
const quietAgentId = 'bot-retro-quiet-agent';
const botTopicId = 'bot-retro-bot-topic';
const chatTopicId = 'bot-retro-chat-topic';

const windowStart = new Date('2026-11-01T00:00:00.000Z');
const windowEnd = new Date('2026-11-02T00:00:00.000Z');
const inWindow = new Date('2026-11-01T12:00:00.000Z');
const beforeWindow = new Date('2026-10-31T12:00:00.000Z');
const window = { agentId, limit: 10, windowEnd, windowStart };

const seedBase = async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values([
    { description: 'Answers on Discord', id: agentId, title: 'Shadow', userId },
    { id: quietAgentId, title: 'Quiet', userId },
  ]);
  await serverDB.insert(topics).values([
    {
      agentId,
      historySummary: 'Helped with deploy questions',
      id: botTopicId,
      metadata: { bot: { platform: 'discord' } } as never,
      title: 'deploy thread',
      trigger: 'bot',
      userId,
    },
    { agentId: quietAgentId, id: chatTopicId, title: 'in-app chat', userId },
  ]);
};

describe('AgentBotRetroModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
  });

  it('lists only agents with bot-topic messages inside the window', async () => {
    await seedBase();
    await serverDB.insert(messages).values([
      {
        agentId,
        content: 'hi',
        createdAt: inWindow,
        id: 'm-bot',
        role: 'user',
        topicId: botTopicId,
        userId,
      },
      {
        agentId: quietAgentId,
        content: 'in app',
        createdAt: inWindow,
        id: 'm-chat',
        role: 'user',
        topicId: chatTopicId,
        userId,
      },
    ]);

    const model = new AgentBotRetroModel(serverDB, userId);

    await expect(model.listBotActiveAgents({ limit: 10, windowEnd, windowStart })).resolves.toEqual(
      [agentId],
    );
    // A reused bot thread with no messages today is not activity.
    await expect(
      model.listBotActiveAgents({ limit: 10, windowEnd: windowStart, windowStart: beforeWindow }),
    ).resolves.toEqual([]);
    await expect(
      new AgentBotRetroModel(serverDB, otherUserId).listBotActiveAgents({
        limit: 10,
        windowEnd,
        windowStart,
      }),
    ).resolves.toEqual([]);
  });

  it('summarizes bot topics with replies, failed tools and failed messages of the window', async () => {
    await seedBase();
    await serverDB.insert(messages).values([
      {
        agentId,
        content: 'q',
        createdAt: inWindow,
        id: 'm-1',
        role: 'user',
        topicId: botTopicId,
        userId,
      },
      {
        agentId,
        content: 'a',
        createdAt: inWindow,
        id: 'm-2',
        role: 'assistant',
        topicId: botTopicId,
        userId,
      },
      {
        agentId,
        content: '',
        createdAt: inWindow,
        error: { message: 'provider overloaded' },
        id: 'm-3',
        role: 'assistant',
        topicId: botTopicId,
        userId,
      },
      {
        agentId,
        content: 'tool',
        createdAt: inWindow,
        id: 'm-4',
        role: 'tool',
        topicId: botTopicId,
        userId,
      },
      {
        agentId,
        content: 'old',
        createdAt: beforeWindow,
        id: 'm-old',
        role: 'assistant',
        topicId: botTopicId,
        userId,
      },
    ]);
    await serverDB.insert(messagePlugins).values({
      apiName: 'search',
      error: { message: 'timeout' },
      id: 'm-4',
      identifier: 'web-search',
      toolCallId: 'call-1',
      userId,
    });

    const [topic] = await new AgentBotRetroModel(serverDB, userId).listBotTopics(window);

    expect(topic).toMatchObject({
      assistantMessageCount: 2,
      messageCount: 4,
      platform: 'discord',
      summary: 'Helped with deploy questions',
      title: 'deploy thread',
      topicId: botTopicId,
    });
    expect(topic.failedToolCalls).toEqual([
      {
        apiName: 'search',
        errorSummary: expect.stringContaining('timeout'),
        identifier: 'web-search',
      },
    ]);
    expect(topic.failedMessages).toEqual([expect.stringContaining('provider overloaded')]);
  });

  it('keeps a last-activity timestamp the driver hands back as a Date', async () => {
    await seedBase();
    await serverDB.insert(messages).values({
      agentId,
      content: 'hi',
      createdAt: inWindow,
      id: 'm-date',
      role: 'user',
      topicId: botTopicId,
      userId,
    });

    // The proxy driver parses aggregates through the Postgres type parsers, so
    // MAX(created_at) arrives as a Date rather than the string a raw `sql` field
    // normally carries.
    const proxy = createProxyTestDB(serverDB);
    const [topic] = await new AgentBotRetroModel(proxy, userId).listBotTopics(window);

    expect(topic.lastActivityAt).toBeInstanceOf(Date);
    expect(topic.lastActivityAt.toISOString()).toBe(inWindow.toISOString());
  });

  it('drops a grouped row that comes back without an agent', async () => {
    await seedBase();
    await serverDB.insert(messages).values({
      agentId,
      content: 'in the agent thread',
      createdAt: inWindow,
      id: 'm-agent',
      role: 'user',
      topicId: botTopicId,
      userId,
    });

    // The INNER JOIN on agents keeps `topics.agent_id` non-null in practice, so
    // a result set that still hands back none is a defensive case the query
    // cannot produce; it must not put `null` into the review list.
    const proxy = createProxyTestDB(serverDB, (query, result) =>
      query.includes('group by') ? [[null, 1]] : result.rows,
    );

    await expect(
      new AgentBotRetroModel(proxy, userId).listBotActiveAgents({
        limit: 10,
        windowEnd,
        windowStart,
      }),
    ).resolves.toEqual([]);
  });

  it('lists the vent tool calls of the window, rejected ones included', async () => {
    await seedBase();
    await serverDB.insert(messages).values([
      {
        agentId,
        content: '',
        createdAt: inWindow,
        id: 'v-1',
        role: 'tool',
        topicId: botTopicId,
        userId,
      },
      {
        agentId,
        content: '',
        createdAt: inWindow,
        id: 'v-2',
        role: 'tool',
        topicId: botTopicId,
        userId,
      },
      {
        agentId,
        content: '',
        createdAt: beforeWindow,
        id: 'v-old',
        role: 'tool',
        topicId: botTopicId,
        userId,
      },
      {
        agentId,
        content: '',
        createdAt: inWindow,
        id: 'not-vent',
        role: 'tool',
        topicId: botTopicId,
        userId,
      },
    ]);
    await serverDB.insert(messagePlugins).values([
      {
        apiName: 'vent',
        arguments: '{"category":"platform_bug","summary":"search 500s"}',
        id: 'v-1',
        identifier: 'lobe-agent',
        state: { recorded: true, ventId: 'v-1' },
        userId,
      },
      {
        apiName: 'vent',
        arguments: '{}',
        id: 'v-2',
        identifier: 'lobe-agent',
        state: { recorded: false },
        userId,
      },
      { apiName: 'vent', arguments: '{}', id: 'v-old', identifier: 'lobe-agent', userId },
      {
        apiName: 'callSubAgent',
        arguments: '{}',
        id: 'not-vent',
        identifier: 'lobe-agent',
        userId,
      },
    ]);

    const vents = await new AgentBotRetroModel(serverDB, userId).listVents(window);

    expect(vents.map((vent) => vent.messageId).sort()).toEqual(['v-1', 'v-2']);
    expect(vents.find((vent) => vent.messageId === 'v-2')?.state).toEqual({ recorded: false });
  });

  it('keeps only decisions whose latest owner mark says the wake was wrong', async () => {
    await seedBase();
    const [signal] = await serverDB
      .insert(signals)
      .values({
        externalId: 'app:thread:1',
        payload: {},
        scopeKey: 'discord:app',
        source: 'bot:discord',
        type: 'bot.message.merged',
        userId,
      })
      .returning();
    const decisionRow = (id: string, createdAt: Date) => ({
      agentId,
      createdAt,
      id,
      outcome: 'wake' as const,
      pipelineVersion: `v-${id}`,
      scopeKey: 'discord:app',
      signalId: signal.id,
      topicId: botTopicId,
      userId,
    });
    const falseWake = '00000000-0000-4000-8000-000000000001';
    const clearedMark = '00000000-0000-4000-8000-000000000002';
    const agentOnly = '00000000-0000-4000-8000-000000000003';
    const oldMark = '00000000-0000-4000-8000-000000000004';
    await serverDB
      .insert(signalDecisions)
      .values([
        decisionRow(falseWake, inWindow),
        decisionRow(clearedMark, inWindow),
        decisionRow(agentOnly, inWindow),
        decisionRow(oldMark, beforeWindow),
      ]);
    await serverDB.insert(signalDecisionLabels).values([
      {
        createdAt: new Date('2026-11-01T13:00:00.000Z'),
        decisionId: falseWake,
        label: 'false_wake',
        metadata: { rationale: 'was talking to a human' },
        source: 'user',
      },
      {
        createdAt: new Date('2026-11-01T13:00:00.000Z'),
        decisionId: clearedMark,
        label: 'false_wake',
        source: 'user',
      },
      {
        createdAt: new Date('2026-11-01T14:00:00.000Z'),
        decisionId: clearedMark,
        label: 'cleared',
        source: 'user',
      },
      { decisionId: agentOnly, label: 'false_wake', source: 'agent:no_reply' },
      { decisionId: oldMark, label: 'missed_wake', source: 'user' },
    ]);

    const marks = await new AgentBotRetroModel(serverDB, userId).listOwnerWakeMarks(window);

    expect(marks).toEqual([
      expect.objectContaining({
        decisionId: falseWake,
        label: 'false_wake',
        outcome: 'wake',
        reason: 'was talking to a human',
        topicId: botTopicId,
      }),
    ]);
  });

  it('reads the agent meta only for the owning user', async () => {
    await seedBase();

    await expect(new AgentBotRetroModel(serverDB, userId).getAgentMeta(agentId)).resolves.toEqual({
      description: 'Answers on Discord',
      title: 'Shadow',
    });
    await expect(
      new AgentBotRetroModel(serverDB, otherUserId).getAgentMeta(agentId),
    ).resolves.toBeUndefined();
  });
});
