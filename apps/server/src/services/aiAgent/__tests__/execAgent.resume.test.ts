import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockCreateOperation, mockFindById, mockMessageCreate, mockMessageQuery, mockQueryTree } =
  vi.hoisted(() => ({
    mockCreateOperation: vi.fn(),
    mockFindById: vi.fn(),
    mockMessageCreate: vi.fn(),
    mockMessageQuery: vi.fn(),
    mockQueryTree: vi.fn(),
  }));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
    findById: mockFindById,
    query: mockMessageQuery,
    queryTopicMessageTree: mockQueryTree,
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: vi.fn().mockImplementation(() => ({
    getLatestPersonaDocument: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();

  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

describe('AiAgentService.execAgent - resume mode', () => {
  let service: AiAgentService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });

    mockFindById.mockResolvedValue({
      id: 'parent-msg-1',
      sessionId: 'session-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    mockMessageQuery.mockResolvedValue([
      { content: 'history user', id: 'history-1', role: 'user' },
      { content: 'history assistant', id: 'history-2', role: 'assistant' },
    ]);

    mockMessageCreate.mockResolvedValue({ id: 'assistant-msg-new' });
    mockQueryTree.mockResolvedValue([]);

    service = new AiAgentService({} as any, 'user-1');
  });

  it('should create only a new assistant message in resume mode and use caller appContext', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      appContext: {
        sessionId: 'session-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      parentMessageId: 'parent-msg-1',
      prompt: 'caller prompt is ignored for runtime payload messages',
      resume: true,
    });

    expect(mockFindById).toHaveBeenCalledWith('parent-msg-1');
    expect(mockMessageQuery).toHaveBeenCalledWith(
      {
        sessionId: 'session-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      expect.any(Object),
    );
    expect(mockMessageCreate).toHaveBeenCalledTimes(1);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.any(String),
        parentId: 'parent-msg-1',
        role: 'assistant',
        threadId: 'thread-1',
        topicId: 'topic-1',
      }),
    );

    expect(mockCreateOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.objectContaining({
          threadId: 'thread-1',
          topicId: 'topic-1',
        }),
        initialContext: expect.objectContaining({
          payload: expect.objectContaining({
            message: [{ content: '' }],
            parentMessageId: 'parent-msg-1',
          }),
          phase: 'user_input',
        }),
        initialMessages: [
          { content: 'history user', id: 'history-1', role: 'user' },
          { content: 'history assistant', id: 'history-2', role: 'assistant' },
        ],
      }),
    );
  });

  it('should reject missing appContext in resume mode', async () => {
    await expect(
      service.execAgent({
        agentId: 'agent-1',
        parentMessageId: 'parent-msg-1',
        prompt: '',
        resume: true,
      }),
    ).rejects.toThrow('appContext is required when resume is true');
  });

  it('should reject appContext.topicId mismatch in resume mode', async () => {
    await expect(
      service.execAgent({
        agentId: 'agent-1',
        appContext: {
          sessionId: 'session-1',
          threadId: 'thread-1',
          topicId: 'topic-other',
        },
        parentMessageId: 'parent-msg-1',
        prompt: '',
        resume: true,
      }),
    ).rejects.toThrow('appContext.topicId does not match parent message');
  });

  it('should require parentMessageId when resume is true', async () => {
    await expect(
      service.execAgent({
        agentId: 'agent-1',
        prompt: '',
        resume: true,
      }),
    ).rejects.toThrow('parentMessageId is required when resume is true');
  });

  // Regression: gateway/server-runtime regenerate must replace, not continue.
  // The flat topic query returns the anchor user message's existing answer
  // branch; feeding it back makes the model continue the old answer
  // ([U1, A1] -> continue) instead of producing a fresh one ([U1] -> A2).
  it('regenerate: drops the anchor user message existing answer branch from history', async () => {
    mockFindById.mockResolvedValue({
      id: 'u1',
      role: 'user',
      sessionId: 'session-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    mockMessageQuery.mockResolvedValue([
      { content: 'prior question', id: 'prior-u', role: 'user' },
      { content: 'prior answer', id: 'prior-a', parentId: 'prior-u', role: 'assistant' },
      { content: 'the question', id: 'u1', parentId: 'prior-a', role: 'user' },
      // Old answer being regenerated — must NOT be fed back as context.
      { content: 'OLD answer', id: 'a1', parentId: 'u1', role: 'assistant' },
    ]);
    mockQueryTree.mockResolvedValue([
      { id: 'prior-u', messageGroupId: null, parentId: null },
      { id: 'prior-a', messageGroupId: null, parentId: 'prior-u' },
      { id: 'u1', messageGroupId: null, parentId: 'prior-a' },
      { id: 'a1', messageGroupId: null, parentId: 'u1' },
    ]);

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { sessionId: 'session-1', threadId: 'thread-1', topicId: 'topic-1' },
      parentMessageId: 'u1',
      prompt: 'ignored',
      resume: true,
    });

    const call = mockCreateOperation.mock.calls[0][0];
    expect(call.initialMessages.map((m: any) => m.id)).toEqual(['prior-u', 'prior-a', 'u1']);
  });

  // Regression: regenerating a MIDDLE turn must also drop the turns that
  // continued from it (they live on the old branch), so history ends at U1.
  it('regenerate: drops later turns that continued from the anchor (middle-turn regenerate)', async () => {
    mockFindById.mockResolvedValue({
      id: 'u1',
      role: 'user',
      sessionId: 'session-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    mockMessageQuery.mockResolvedValue([
      { content: 'the question', id: 'u1', role: 'user' },
      { content: 'OLD answer', id: 'a1', parentId: 'u1', role: 'assistant' },
      { content: 'follow-up question', id: 'u2', parentId: 'a1', role: 'user' },
      { content: 'follow-up answer', id: 'a2', parentId: 'u2', role: 'assistant' },
    ]);
    mockQueryTree.mockResolvedValue([
      { id: 'u1', messageGroupId: null, parentId: null },
      { id: 'a1', messageGroupId: null, parentId: 'u1' },
      { id: 'u2', messageGroupId: null, parentId: 'a1' },
      { id: 'a2', messageGroupId: null, parentId: 'u2' },
    ]);

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { sessionId: 'session-1', threadId: 'thread-1', topicId: 'topic-1' },
      parentMessageId: 'u1',
      prompt: 'ignored',
      resume: true,
    });

    const call = mockCreateOperation.mock.calls[0][0];
    expect(call.initialMessages.map((m: any) => m.id)).toEqual(['u1']);
  });

  // Regression: after /compact, the old branch is hidden inside a compression
  // group and `query` returns a synthetic `compressedGroup` node that carries no
  // `parentId`. Pruning must use the raw message tree so the group (whose members
  // descend from the anchor) is dropped instead of being fed back as a summary.
  it('regenerate: drops a compressedGroup node whose compacted members descend from the anchor', async () => {
    mockFindById.mockResolvedValue({
      id: 'u1',
      role: 'user',
      sessionId: 'session-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    // `query` hides the grouped messages and injects a synthetic group node
    // (id = group id, role = 'compressedGroup', no parentId).
    mockMessageQuery.mockResolvedValue([
      { content: 'prior question', id: 'prior-u', role: 'user' },
      { content: 'prior answer', id: 'prior-a', parentId: 'prior-u', role: 'assistant' },
      { content: 'the question', id: 'u1', parentId: 'prior-a', role: 'user' },
      { content: 'summary of old branch', id: 'grp-1', role: 'compressedGroup' },
    ]);
    // Raw tree still has the hidden members linked to the anchor via parentId.
    mockQueryTree.mockResolvedValue([
      { id: 'prior-u', messageGroupId: null, parentId: null },
      { id: 'prior-a', messageGroupId: null, parentId: 'prior-u' },
      { id: 'u1', messageGroupId: null, parentId: 'prior-a' },
      { id: 'a1', messageGroupId: 'grp-1', parentId: 'u1' },
      { id: 'u2', messageGroupId: 'grp-1', parentId: 'a1' },
      { id: 'a2', messageGroupId: 'grp-1', parentId: 'u2' },
    ]);

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { sessionId: 'session-1', threadId: 'thread-1', topicId: 'topic-1' },
      parentMessageId: 'u1',
      prompt: 'ignored',
      resume: true,
    });

    const call = mockCreateOperation.mock.calls[0][0];
    expect(call.initialMessages.map((m: any) => m.id)).toEqual(['prior-u', 'prior-a', 'u1']);
  });

  // Guard: a compression group of PRIOR turns (not descended from the anchor)
  // must be kept — it is legitimate earlier context.
  it('regenerate: keeps a compressedGroup node whose members precede the anchor', async () => {
    mockFindById.mockResolvedValue({
      id: 'u1',
      role: 'user',
      sessionId: 'session-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    mockMessageQuery.mockResolvedValue([
      { content: 'summary of early turns', id: 'grp-0', role: 'compressedGroup' },
      { content: 'the question', id: 'u1', parentId: 'old-a', role: 'user' },
      { content: 'OLD answer', id: 'a1', parentId: 'u1', role: 'assistant' },
    ]);
    mockQueryTree.mockResolvedValue([
      { id: 'old-u', messageGroupId: 'grp-0', parentId: null },
      { id: 'old-a', messageGroupId: 'grp-0', parentId: 'old-u' },
      { id: 'u1', messageGroupId: null, parentId: 'old-a' },
      { id: 'a1', messageGroupId: null, parentId: 'u1' },
    ]);

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { sessionId: 'session-1', threadId: 'thread-1', topicId: 'topic-1' },
      parentMessageId: 'u1',
      prompt: 'ignored',
      resume: true,
    });

    const call = mockCreateOperation.mock.calls[0][0];
    expect(call.initialMessages.map((m: any) => m.id)).toEqual(['grp-0', 'u1']);
  });

  // Guard: the human-approval resume path anchors on a tool message and must
  // keep the in-flight turn — including parallel-tool sibling messages — intact.
  it('resume on a non-user anchor (tool message) keeps full history untouched', async () => {
    mockFindById.mockResolvedValue({
      id: 'tool-1',
      role: 'tool',
      sessionId: 'session-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    mockMessageQuery.mockResolvedValue([
      { content: 'q', id: 'u1', role: 'user' },
      { content: 'a with tool calls', id: 'a1', parentId: 'u1', role: 'assistant' },
      { content: 'tool result A', id: 'tool-1', parentId: 'a1', role: 'tool' },
      { content: 'tool result B', id: 'tool-2', parentId: 'a1', role: 'tool' },
    ]);

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { sessionId: 'session-1', threadId: 'thread-1', topicId: 'topic-1' },
      parentMessageId: 'tool-1',
      prompt: '',
      resume: true,
    });

    const call = mockCreateOperation.mock.calls[0][0];
    expect(call.initialMessages.map((m: any) => m.id)).toEqual(['u1', 'a1', 'tool-1', 'tool-2']);
  });
});
