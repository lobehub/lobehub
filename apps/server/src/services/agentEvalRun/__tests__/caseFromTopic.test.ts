import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, topics } from '@/database/schemas';
import { draftCaseFromTopic } from '@/server/services/agentEvalRun/caseFromTopic';
import { createEvalRunDeps } from '@/server/services/agentEvalRun/deps';

import { cleanupDB, serverDB, userId } from './_setup';

const generateObject = vi.fn();
vi.mock('@/server/modules/AgentRuntime/llmRelay/oneShot', () => ({
  initModelRuntimeForRequest: vi.fn(async () => ({ generateObject })),
}));

const at = (minutes: number) => new Date(Date.UTC(2026, 6, 21, 10, minutes));

beforeEach(async () => {
  await cleanupDB();
  generateObject.mockReset();
  generateObject.mockResolvedValue({
    rules: [
      'Must: Search mail for the June invoice.',
      'reply in English',
      'Must not: Send anything.',
    ],
  });
});

const createConversation = async () => {
  const [topic] = await serverDB.insert(topics).values({ title: 'Invoices', userId }).returning();
  await serverDB.insert(messages).values([
    {
      content: 'Hi, I need help with invoices.',
      createdAt: at(0),
      role: 'user',
      topicId: topic.id,
      userId,
    },
    { content: 'Sure, which one?', createdAt: at(1), role: 'assistant', topicId: topic.id, userId },
    {
      content: 'Find the June invoice from Acme and tell me the amount.',
      createdAt: at(2),
      role: 'user',
      topicId: topic.id,
      userId,
    },
    {
      content: 'The June invoice from Acme is $1,200.',
      createdAt: at(4),
      role: 'assistant',
      topicId: topic.id,
      userId,
    },
  ]);
  return topic;
};

describe('draftCaseFromTopic', () => {
  it('turns the last request into the case and the earlier turns into context', async () => {
    const topic = await createConversation();

    const draft = await draftCaseFromTopic(createEvalRunDeps(serverDB, userId), topic.id);

    expect(draft.input).toBe('Find the June invoice from Acme and tell me the amount.');
    expect(draft.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(draft.answer).toBe('The June invoice from Acme is $1,200.');
    expect(draft.sessionDate).toBe('2026-07-21');
    expect(draft.title).toBe('Find the June invoice from Acme and tell me the amount.');
    expect(draft.agent).toBeUndefined();
    // Drafted rules are normalised to Must / Must not lines.
    expect(draft.rules).toEqual([
      'Must: Search mail for the June invoice.',
      'Must: reply in English',
      'Must not: Send anything.',
    ]);
    const prompt = generateObject.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain('[Final request]\nFind the June invoice');
    expect(prompt).toContain('[Recorded answer]');
  });

  it('skips the rule draft when asked and survives a failed one', async () => {
    const topic = await createConversation();

    const silent = await draftCaseFromTopic(createEvalRunDeps(serverDB, userId), topic.id, {
      draftRules: false,
    });
    expect(silent.rules).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();

    generateObject.mockRejectedValue(new Error('provider down'));
    const failed = await draftCaseFromTopic(createEvalRunDeps(serverDB, userId), topic.id);
    expect(failed.rules).toEqual([]);
    expect(failed.input).toContain('June invoice');
  });

  it('refuses a conversation without a user request and an unknown topic', async () => {
    const [topic] = await serverDB.insert(topics).values({ title: 'Empty', userId }).returning();
    await serverDB
      .insert(messages)
      .values([{ content: 'Hello!', role: 'assistant', topicId: topic.id, userId }]);

    await expect(draftCaseFromTopic(createEvalRunDeps(serverDB, userId), topic.id)).rejects.toThrow(
      'The conversation has no user message to test',
    );
    await expect(
      draftCaseFromTopic(createEvalRunDeps(serverDB, userId), 'tpc_missing'),
    ).rejects.toThrow('Topic not found');
  });
});
