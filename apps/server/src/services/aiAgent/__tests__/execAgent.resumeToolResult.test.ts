import type { LobeChatDatabase } from '@lobechat/database';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockFindById,
  mockFindMessagePlugin,
  mockMessageCreate,
  mockMessageQuery,
  mockUpdateMessagePlugin,
  mockUpdatePluginState,
  mockUpdateToolMessage,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockFindById: vi.fn(),
  mockFindMessagePlugin: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockUpdateMessagePlugin: vi.fn(),
  mockUpdatePluginState: vi.fn(),
  mockUpdateToolMessage: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    findById: mockFindById,
    findMessagePlugin: mockFindMessagePlugin,
    query: mockMessageQuery,
    update: vi.fn().mockResolvedValue({}),
    updateMessagePlugin: mockUpdateMessagePlugin,
    updatePluginState: mockUpdatePluginState,
    updateToolMessage: mockUpdateToolMessage,
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({ queryAgents: vi.fn().mockResolvedValue([]) })),
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
  PluginModel: vi.fn().mockImplementation(() => ({ query: vi.fn().mockResolvedValue([]) })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    updateMetadata: vi.fn(),
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
  FileService: vi.fn().mockImplementation(() => ({ uploadFromUrl: vi.fn() })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { isConfigured: false, queryDeviceList: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
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

describe('AiAgentService.execAgent - resumeToolResult', () => {
  let service: AiAgentService;

  // `messages` row — `findById` returns this.
  const pendingToolMessage = {
    id: 'tool-msg-1',
    role: 'tool',
    sessionId: 'session-1',
    threadId: 'thread-1',
    topicId: 'topic-1',
  };
  // `message_plugins` row — fetched via findMessagePlugin.
  const pendingToolPlugin = {
    apiName: 'askUserQuestion',
    arguments: '{"question":"favorite color?"}',
    identifier: 'lobe-agent',
    toolCallId: 'call_ask',
    type: 'builtin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockFindById.mockResolvedValue(pendingToolMessage);
    mockFindMessagePlugin.mockResolvedValue(pendingToolPlugin);
    mockMessageQuery.mockResolvedValue([{ content: 'hi', id: 'history-1', role: 'user' }]);
    mockMessageCreate.mockResolvedValue({ id: 'assistant-msg-new' });
    mockUpdateMessagePlugin.mockResolvedValue(undefined);
    mockUpdatePluginState.mockResolvedValue(undefined);
    mockUpdateToolMessage.mockResolvedValue(undefined);
    service = new AiAgentService({} as unknown as LobeChatDatabase, 'user-1');
  });

  const baseParams = {
    agentId: 'agent-1',
    appContext: { sessionId: 'session-1', threadId: 'thread-1', topicId: 'topic-1' },
    parentMessageId: 'tool-msg-1',
    prompt: '',
  };

  it('writes the human answer as tool content, marks approved, and resumes from tool_result (no re-execution)', async () => {
    await service.execAgent({
      ...baseParams,
      resumeToolResult: {
        content: 'My favorite color is blue',
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_ask',
      },
    });

    // The human answer becomes the tool message's result content.
    expect(mockUpdateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
      content: 'My favorite color is blue',
    });
    // Intervention is marked approved so the pending state clears.
    expect(mockUpdateMessagePlugin).toHaveBeenCalledWith('tool-msg-1', {
      intervention: { status: 'approved' },
    });

    // Resumes from `tool_result` — NOT `human_approved_tool` (which would
    // re-dispatch the tool and overwrite the answer).
    expect(mockCreateOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContext: expect.objectContaining({
          payload: expect.objectContaining({
            assistantMessageId: 'assistant-msg-new',
            parentMessageId: 'tool-msg-1',
          }),
          phase: 'tool_result',
        }),
      }),
    );
    const call = mockCreateOperation.mock.calls[0][0];
    expect(call.initialContext.phase).not.toBe('human_approved_tool');
  });

  it('persists pluginState when provided', async () => {
    await service.execAgent({
      ...baseParams,
      resumeToolResult: {
        content: 'blue',
        parentMessageId: 'tool-msg-1',
        pluginState: { askUserAnswers: { 'favorite color?': 'blue' } },
        toolCallId: 'call_ask',
      },
    });

    expect(mockUpdatePluginState).toHaveBeenCalledWith('tool-msg-1', {
      askUserAnswers: { 'favorite color?': 'blue' },
    });
  });

  it('does not persist pluginState when omitted', async () => {
    await service.execAgent({
      ...baseParams,
      resumeToolResult: {
        content: 'blue',
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_ask',
      },
    });

    expect(mockUpdatePluginState).not.toHaveBeenCalled();
  });

  describe('validation guards', () => {
    it('throws when the parent message is not role=tool', async () => {
      mockFindById.mockResolvedValue({ ...pendingToolMessage, role: 'user' });

      await expect(
        service.execAgent({
          ...baseParams,
          resumeToolResult: {
            content: 'blue',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_ask',
          },
        }),
      ).rejects.toThrow(/role='tool'/);
    });

    it('throws when the stored tool_call_id does not match the resume request', async () => {
      mockFindMessagePlugin.mockResolvedValue({ ...pendingToolPlugin, toolCallId: 'call_other' });

      await expect(
        service.execAgent({
          ...baseParams,
          resumeToolResult: {
            content: 'blue',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_ask',
          },
        }),
      ).rejects.toThrow(/toolCallId mismatch/);
    });

    it('throws when no plugin row exists for the target message', async () => {
      mockFindMessagePlugin.mockResolvedValue(undefined);

      await expect(
        service.execAgent({
          ...baseParams,
          resumeToolResult: {
            content: 'blue',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_ask',
          },
        }),
      ).rejects.toThrow(/no plugin row/);
    });
  });
});
