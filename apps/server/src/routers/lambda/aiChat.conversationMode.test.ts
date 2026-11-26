// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiChatRouter } from './aiChat';

const { resolveMode, savePair, getMessages, createTopic, useTopic, agentPolicy } = vi.hoisted(
  () => ({
    agentPolicy: vi.fn(),
    useTopic: vi.fn(),
    createTopic: vi.fn(),
    getMessages: vi.fn(),
    resolveMode: vi.fn(),
    savePair: vi.fn(),
  }),
);

vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentToolPolicy = agentPolicy;
    touchUpdatedAt = vi.fn();
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    createUserAndAssistantMessages = savePair;
    getLatestSpineMessageId = async () => undefined;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    resolveConversationMode = resolveMode;
  },
}));
vi.mock('@/database/models/thread');
vi.mock('@/server/routers/lambda/_helpers/conversationResourceGuard', () => ({
  assertCanUseConversationTargets: vi.fn(),
  assertCanUseTopicTargets: useTopic,
}));
vi.mock('@/database/repositories/topic', () => ({
  TopicRepository: class {
    create = createTopic;
  },
}));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: class {
    getMessagesAndTopics = getMessages;
  },
}));
vi.mock('@/server/routers/lambda/_helpers/resolveContext', () => ({
  resolveContext: async (input: unknown) => input,
}));

const caller = () => aiChatRouter.createCaller({ userId: 'mode-user' } as never);
const input = () => ({
  conversationMode: 'chat' as const,
  newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
  newUserMessage: { content: 'hello' },
  topicId: 'mode-topic',
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveMode.mockResolvedValue('chat');
  createTopic.mockResolvedValue({ id: 'new-topic' });
  getMessages.mockResolvedValue({ messages: [] });
  savePair.mockImplementation(async ({ userMessage }) => ({
    assistantMessage: { id: 'assistant' },
    userMessage: { ...userMessage, id: 'user' },
  }));
});

describe('local execution conversation mode contract', () => {
  it('checks topic USE permission before committing a legacy mode', async () => {
    useTopic.mockRejectedValueOnce(new Error('USE denied'));
    await expect(
      caller().resolveConversationMode({ topicId: 'mode-topic', fallback: 'chat' }),
    ).rejects.toThrow('USE denied');
    expect(resolveMode).not.toHaveBeenCalled();
  });
  it('returns a conflict when another first send wins the database transaction', async () => {
    savePair.mockRejectedValue(
      Object.assign(new Error('Conversation mode is locked'), { status: 409 }),
    );
    await expect(caller().sendMessageInServer(input())).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('does not let a client pre-lock an empty topic through its metadata', async () => {
    await caller().sendMessageInServer({
      ...input(),
      topicId: undefined,
      newTopic: { metadata: { conversationMode: 'agent', boundDeviceId: 'device' } },
    });
    expect(createTopic.mock.calls[0][0].metadata).toEqual({ boundDeviceId: 'device' });
  });
  it("starts a legacy sender's topic in the agent's default mode", async () => {
    const { conversationMode: _mode, ...legacy } = input();
    agentPolicy.mockResolvedValue({ chatConfig: { enableAgentMode: false }, userId: 'mode-user' });
    resolveMode.mockImplementation(async (_topicId: string, fallback: string) => fallback);

    const result = await caller().sendMessageInServer({ ...legacy, agentId: 'agent-1' });

    expect(result.conversationMode).toBe('chat');
    expect(savePair.mock.calls[0][0].userMessage.metadata.conversationMode).toBe('chat');
  });

  it("continues a legacy sender in the topic's locked mode", async () => {
    const { conversationMode: _mode, ...legacy } = input();
    agentPolicy.mockResolvedValue({ chatConfig: { enableAgentMode: false }, userId: 'mode-user' });
    resolveMode.mockResolvedValue('agent');

    const result = await caller().sendMessageInServer({ ...legacy, agentId: 'agent-1' });

    expect(result.conversationMode).toBe('agent');
    expect(savePair.mock.calls[0][0].userMessage.metadata.conversationMode).toBe('agent');
  });

  it('rejects a stale conflicting mode before committing a message', async () => {
    await expect(
      caller().sendMessageInServer({ ...input(), conversationMode: 'agent' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(savePair).not.toHaveBeenCalled();
  });

  it('returns the committed mode with the saved turn', async () => {
    const result = await caller().sendMessageInServer(input());
    expect(result.conversationMode).toBe('chat');
    expect(savePair.mock.calls[0][0].userMessage.metadata.conversationMode).toBe('chat');
  });
});
