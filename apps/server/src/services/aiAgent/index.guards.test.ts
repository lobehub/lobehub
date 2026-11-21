import { RequestTrigger } from '@lobechat/types';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from './index';

const {
  mockAppendRunningOperationChild,
  mockArmScheduledRun,
  mockMessageCreate,
  mockMessageFindById,
  mockMessageUpdate,
  mockTopicCreate,
} = vi.hoisted(() => ({
  mockAppendRunningOperationChild: vi.fn(),
  mockArmScheduledRun: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageFindById: vi.fn(),
  mockMessageUpdate: vi.fn(),
  mockTopicCreate: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      create: mockMessageCreate,
      findById: mockMessageFindById,
      getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
      getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      update: mockMessageUpdate,
    };
  }),
}));

const agentConfig = {
  chatConfig: {},
  files: [],
  id: 'agent-1',
  knowledgeBases: [],
  model: 'gpt-4',
  plugins: [],
  provider: 'openai',
  systemRole: 'You are a helpful assistant',
};

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue(agentConfig),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return { getAgentConfig: vi.fn().mockResolvedValue(agentConfig) };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return { query: vi.fn().mockResolvedValue([]) };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      appendRunningOperationChild: mockAppendRunningOperationChild,
      armScheduledRun: mockArmScheduledRun,
      create: mockTopicCreate,
      findById: vi.fn().mockResolvedValue(undefined),
      releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
      tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
      updateMetadata: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(function () {
    return { create: vi.fn(), findById: vi.fn(), update: vi.fn() };
  }),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn().mockImplementation(function () {
    return {
      findById: vi.fn().mockResolvedValue(undefined),
      getGroupAgentsWithMeta: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: vi.fn().mockResolvedValue({
        autoStarted: true,
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        success: true,
      }),
    };
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(function () {
    return { getLobehubSkillManifests: vi.fn().mockResolvedValue([]) };
  }),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(function () {
    return { getComposioManifests: vi.fn().mockResolvedValue([]) };
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return { uploadFromUrl: vi.fn() };
  }),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
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
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

describe('AiAgentService entry guards', () => {
  let service: AiAgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendRunningOperationChild.mockResolvedValue(true);
    mockArmScheduledRun.mockResolvedValue(undefined);
    mockMessageCreate.mockImplementation(async (row: { role: string }) => ({
      id: row.role === 'assistant' ? 'msg-assistant' : 'msg-user',
    }));
    mockMessageFindById.mockResolvedValue(undefined);
    mockMessageUpdate.mockResolvedValue({});
    mockTopicCreate.mockResolvedValue({ id: 'topic-new' });

    service = new AiAgentService({} as any, 'user-1');
  });

  describe('scheduleAgentRun', () => {
    const future = () => new Date(Date.now() + 60_000).toISOString();

    it.each([
      [{ prompt: 'p', runAt: future() }, 'Either agentId or slug must be provided'],
      [{ agentId: 'agent-1', prompt: 'p', runAt: 'not-a-date' }, 'Invalid runAt: not-a-date'],
      [
        { agentId: 'agent-1', prompt: 'p', runAt: new Date(Date.now() - 1000).toISOString() },
        'runAt must be in the future',
      ],
    ])('rejects invalid input %#', async (params, message) => {
      await expect(service.scheduleAgentRun(params as any)).rejects.toThrow(message);
      expect(mockTopicCreate).not.toHaveBeenCalled();
    });

    it('creates the scheduled topic, persists the user turn, and arms the run', async () => {
      const runAt = new Date(Date.now() + 60_000);
      const prompt = 'x'.repeat(60);

      const result = await service.scheduleAgentRun({
        agentId: 'agent-1',
        fileIds: ['file-1'],
        groupId: 'group-1',
        prompt,
        runAt: runAt.toISOString(),
      });

      expect(mockTopicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          groupId: 'group-1',
          title: `${'x'.repeat(50)}...`,
          trigger: 'chat',
        }),
      );
      expect(mockMessageCreate).toHaveBeenCalledWith({
        agentId: 'agent-1',
        content: prompt,
        files: ['file-1'],
        groupId: 'group-1',
        metadata: { trigger: RequestTrigger.Scheduled },
        role: 'user',
        topicId: 'topic-new',
      });
      expect(mockArmScheduledRun).toHaveBeenCalledWith(
        'topic-new',
        expect.objectContaining({
          kind: 'delayed_start',
          runAt: runAt.toISOString(),
          userMessageId: 'msg-user',
        }),
      );
      expect(result).toEqual({
        agentId: 'agent-1',
        runAt: runAt.toISOString(),
        topicId: 'topic-new',
      });
    });
  });

  describe('execAgent', () => {
    it('requires an agent identifier', async () => {
      await expect(service.execAgent({ prompt: 'p' } as any)).rejects.toThrow(
        'Either agentId or slug must be provided',
      );
    });

    it('accepts only one intervention resume form', async () => {
      await expect(
        service.execAgent({
          agentId: 'agent-1',
          prompt: 'p',
          resumeApproval: { approvalStatus: 'approved', parentMessageId: 'm' } as any,
          resumeToolResult: { content: 'r', parentMessageId: 'm' } as any,
          hooks: [{ id: 'skip-member-continuation' } as any],
        }),
      ).rejects.toThrow(
        'Only one of resumeApproval, resumeApprovals, or resumeToolResult may be provided',
      );
    });

    it('rejects a resume whose parent message does not exist', async () => {
      await expect(
        service.execAgent({
          agentId: 'agent-1',
          appContext: { threadId: 'thread-1', topicId: 'topic-1' },
          parentMessageId: 'missing-msg',
          prompt: 'p',
          resume: true,
        }),
      ).rejects.toThrow('Parent message not found: missing-msg');
    });

    it('rejects a start reservation that conflicts with the intervention identity', async () => {
      await expect(
        service.execAgent({
          agentId: 'agent-1',
          appContext: { topicId: 'topic-1' },
          approvalResolutionRequestId: 'resolution-1',
          prompt: 'p',
          topicStartReservationId: 'other-reservation',
        }),
      ).rejects.toThrow('Intervention continuation reservation identity conflict');
    });

    it('returns an error result when the supervisor is gone before the member claims its slot', async () => {
      mockAppendRunningOperationChild.mockResolvedValue(false);

      const result = await service.execAgent({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-1' },
        prompt: 'p',
        topicStartOwnerOperationId: 'op-supervisor',
      });

      const errorMessage = 'Group supervisor finished before this member could start.';
      expect(mockAppendRunningOperationChild).toHaveBeenCalledWith(
        'topic-1',
        'op-supervisor',
        expect.objectContaining({ assistantMessageId: 'msg-assistant' }),
      );
      expect(result).toMatchObject({
        assistantMessageId: 'msg-assistant',
        autoStarted: false,
        error: errorMessage,
        status: 'error',
        success: false,
        topicId: 'topic-1',
        userMessageId: 'msg-user',
      });
      expect(mockMessageUpdate).toHaveBeenCalledWith('msg-assistant', {
        content: '',
        error: {
          body: { detail: errorMessage },
          message: errorMessage,
          type: 'ServerAgentRuntimeError',
        },
      });
    });
  });
});
