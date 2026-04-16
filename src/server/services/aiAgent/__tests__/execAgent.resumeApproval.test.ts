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
  mockUpdateToolMessage,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockFindById: vi.fn(),
  mockFindMessagePlugin: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockUpdateMessagePlugin: vi.fn(),
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

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    getKlavisManifests: vi.fn().mockResolvedValue([]),
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

vi.mock('@/server/services/toolExecution/deviceProxy', () => ({
  deviceProxy: { isConfigured: false, queryDeviceList: vi.fn().mockResolvedValue([]) },
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

describe('AiAgentService.execAgent - resumeApproval', () => {
  let service: AiAgentService;

  // `messages` row — `findById` returns this. Note plugin metadata (apiName,
  // identifier, etc.) lives in a separate `message_plugins` table.
  const pendingToolMessage = {
    id: 'tool-msg-1',
    role: 'tool',
    sessionId: 'session-1',
    threadId: 'thread-1',
    topicId: 'topic-1',
  };
  // `message_plugins` row — fetched via `db.query.messagePlugins.findFirst`.
  const pendingToolPlugin = {
    apiName: 'runCommand',
    arguments: '{"command":"echo"}',
    identifier: 'lobe-local-system',
    toolCallId: 'call_xyz',
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
    mockUpdateToolMessage.mockResolvedValue(undefined);
    // `MessageModel` is fully mocked above, so the service never touches the
    // raw `db` arg — cast an empty stub through `unknown` to satisfy the
    // `LobeChatDatabase` parameter type without dragging the real schema.
    service = new AiAgentService({} as unknown as LobeChatDatabase, 'user-1');
  });

  const baseParams = {
    agentId: 'agent-1',
    appContext: { sessionId: 'session-1', threadId: 'thread-1', topicId: 'topic-1' },
    parentMessageId: 'tool-msg-1',
    prompt: '',
  };

  describe('decision=approved', () => {
    it('persists intervention=approved and seeds initialContext for human_approved_tool', async () => {
      await service.execAgent({
        ...baseParams,
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      });

      expect(mockUpdateMessagePlugin).toHaveBeenCalledWith('tool-msg-1', {
        intervention: { status: 'approved' },
      });
      // `approved` decision never writes tool content — the content arrives
      // when the approved tool actually executes.
      expect(mockUpdateToolMessage).not.toHaveBeenCalled();

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({
              approvedToolCall: expect.objectContaining({
                apiName: 'runCommand',
                arguments: '{"command":"echo"}',
                id: 'call_xyz',
                identifier: 'lobe-local-system',
              }),
              parentMessageId: 'tool-msg-1',
              skipCreateToolMessage: true,
            }),
            phase: 'human_approved_tool',
          }),
        }),
      );
    });
  });

  // Server handles `rejected` and `rejected_continue` identically — both
  // persist the rejection and resume the LLM with the updated history so it
  // can respond to the user. The client-side split is only about optimistic
  // writes / button UX; beyond the DB write there's nothing meaningful to
  // differentiate once the decision is persisted.
  describe.each([
    ['rejected' as const, 'not appropriate', 'with reason: not appropriate'],
    ['rejected_continue' as const, 'too risky', 'with reason: too risky'],
  ])('decision=%s', (decision, rejectionReason, expectedSuffix) => {
    it(`persists rejection + resumes LLM with user_input phase`, async () => {
      await service.execAgent({
        ...baseParams,
        resumeApproval: {
          decision,
          parentMessageId: 'tool-msg-1',
          rejectionReason,
          toolCallId: 'call_xyz',
        },
      });

      expect(mockUpdateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
        content: `User reject this tool calling ${expectedSuffix}`,
      });
      expect(mockUpdateMessagePlugin).toHaveBeenCalledWith('tool-msg-1', {
        intervention: { rejectedReason: rejectionReason, status: 'rejected' },
      });

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({
              message: [{ content: '' }],
              parentMessageId: 'tool-msg-1',
            }),
            phase: 'user_input',
          }),
        }),
      );
    });
  });

  it('falls back to the no-reason rejection string when rejectionReason is omitted', async () => {
    await service.execAgent({
      ...baseParams,
      resumeApproval: {
        decision: 'rejected',
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_xyz',
      },
    });

    expect(mockUpdateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
      content: 'User reject this tool calling without reason',
    });
  });

  describe('validation guards', () => {
    it('throws when the parent message is not role=tool', async () => {
      mockFindById.mockResolvedValue({ ...pendingToolMessage, role: 'user' });

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/role='tool'/);
    });

    it('throws when the stored tool_call_id does not match the resume request', async () => {
      // toolCallId lives on the plugin row — mutate the plugin mock, not the
      // message. This is exactly the class of bug that the separate-table
      // fetch guards against.
      mockFindMessagePlugin.mockResolvedValue({ ...pendingToolPlugin, toolCallId: 'call_other' });

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/toolCallId mismatch/);
    });

    it('throws when no plugin row exists for the target message', async () => {
      mockFindMessagePlugin.mockResolvedValue(undefined);

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/no plugin row/);
    });
  });
});
