import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOwnerPrincipal } from '@/server/services/executionPrincipal';

import { AiAgentService } from '../index';

const { mockCreateOperation, mockGetAgentConfig, mockMessageCreate } = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockMessageCreate: vi.fn(),
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
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn(),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: mockGetAgentConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
    tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
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
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

/**
 * The share-visitor guards run their cap/authorization checks inside a real
 * `db.transaction`, which this suite's `mockDb = {}` cannot provide. These
 * cases only assert how `shareGate` shapes `userInterventionConfig`, so stub
 * the guards out; their own behavior is covered by the dedicated real-Postgres
 * race tests in this directory.
 */
vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: vi.fn().mockImplementation(() => ({
    assertRunnableForVisitor: vi.fn().mockResolvedValue(undefined),
    confirmReservation: vi.fn().mockResolvedValue(true),
    releaseReservation: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../shareVisitorAbuseGuards', () => ({
  reserveShareVisitorTopic: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  reserveShareVisitorTurn: vi.fn().mockResolvedValue({ id: 'msg-1' }),
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

describe('AiAgentService.execAgent - headless approval default', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });
    service = new AiAgentService(mockDb, createOwnerPrincipal(userId));
  });

  it('should default to headless approval mode when userInterventionConfig is not provided', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.userInterventionConfig).toEqual({ approvalMode: 'headless' });
  });

  it('should respect explicit userInterventionConfig when provided', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      userInterventionConfig: { approvalMode: 'manual' },
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.userInterventionConfig).toEqual({ approvalMode: 'manual' });
  });

  it('forwards clientIp / userAgent into the createOperation appContext when provided', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      clientIp: '203.0.113.7',
      prompt: 'Hello',
      userAgent: 'Mozilla/5.0 (Test)',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.appContext).toMatchObject({
      clientIp: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Test)',
    });
  });

  it('leaves clientIp / userAgent undefined in the createOperation appContext when not provided', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const { appContext } = mockCreateOperation.mock.calls[0][0];
    expect(appContext.clientIp).toBeUndefined();
    expect(appContext.userAgent).toBeUndefined();
  });

  it('should respect explicit allow-list approval mode with allowList', async () => {
    const config = { allowList: ['tool-a', 'tool-b'], approvalMode: 'allow-list' as const };

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      userInterventionConfig: config,
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.userInterventionConfig).toEqual(config);
  });

  describe('Agent Share visitor runs (shareGate)', () => {
    // A share run executes under the CREATOR's credentials (see
    // apps/server/src/routers/lambda/shareChat.ts execAgent) with no
    // visitor-facing approval UI. `headless` (the default above) is meant for
    // TRUSTED async tasks and auto-runs any overridable ('required')
    // tool-level intervention — wrong here, since the visitor triggering the
    // call is not the creator and nobody is present to grant consent. Every
    // run carrying a `shareGate` must be forced onto the fail-closed `reject`
    // policy regardless of what the caller passed, so this can't be bypassed
    // by a future execAgent call site that forgets to set it explicitly.
    const shareGate = {
      agentId: 'agent-1',
      generation: 1,
      shareConfig: {} as any,
      shareId: 'share-1',
      visitorUserId: 'visitor-1',
    };

    it('forces the reject policy when shareGate is present and no userInterventionConfig was given', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
        shareGate,
      });

      expect(mockCreateOperation).toHaveBeenCalledTimes(1);
      const callArgs = mockCreateOperation.mock.calls[0][0];
      expect(callArgs.userInterventionConfig).toEqual({ approvalMode: 'reject' });
    });

    it('overrides an explicit non-reject userInterventionConfig when shareGate is present', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
        shareGate,
        // A caller that forgets/misconfigures this must still fail closed.
        userInterventionConfig: { approvalMode: 'auto-run' },
      });

      expect(mockCreateOperation).toHaveBeenCalledTimes(1);
      const callArgs = mockCreateOperation.mock.calls[0][0];
      expect(callArgs.userInterventionConfig).toEqual({ approvalMode: 'reject' });
    });

    it('leaves the headless default untouched for a normal (non-share) creator run', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
      });

      expect(mockCreateOperation).toHaveBeenCalledTimes(1);
      const callArgs = mockCreateOperation.mock.calls[0][0];
      expect(callArgs.userInterventionConfig).toEqual({ approvalMode: 'headless' });
    });
  });
});
