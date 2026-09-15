import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockGetAgentConfig,
  mockGetUserSettings,
  mockMessageCreate,
  mockReserveShareVisitorTurn,
  mockResolveAttachmentsByFileIds,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockReserveShareVisitorTurn: vi.fn(),
  mockResolveAttachmentsByFileIds: vi.fn(),
}));

// `discoverTools` peeks at the attached files' MIME types (creator-scoped
// today; media routing only) — stub it so the bare mock db is never queried.
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(function () {
    return { findByIds: vi.fn().mockResolvedValue([]) };
  }),
}));

vi.mock('@/server/services/file/resolveAttachments', () => ({
  resolveAttachmentsByFileIds: mockResolveAttachmentsByFileIds,
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
      getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
      getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn(),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: mockGetAgentConfig,
    };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return {
      query: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
      tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
      findById: vi.fn().mockResolvedValue(null),
    };
  }),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
    };
  }),
}));

// `UserModel` here is what actually resolves `userTimezone`. Constructed with
// the userId it was called with, so the test can distinguish "read the
// creator's settings" from "read the visitor's settings" purely by which id
// the call site passed in.
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function (_db: unknown, userId: string) {
    return {
      getUserPreference: vi.fn().mockResolvedValue({}),
      getUserSettings: () => mockGetUserSettings(userId),
    };
  }),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: mockCreateOperation,
    };
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(function () {
    return {
      getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(function () {
    return {
      getComposioManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      uploadFromUrl: vi.fn(),
    };
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
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

// The share path's atomic cap reservations open real DB transactions — stub
// them so the forced-headless test below can drive execAgent with a bare mock db.
vi.mock('../shareVisitorAbuseGuards', () => ({
  reserveShareVisitorTopic: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  reserveShareVisitorTurn: mockReserveShareVisitorTurn,
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

describe('AiAgentService.execAgent - share-visitor attachment scope', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const creatorId = 'creator-1';
  const visitorId = 'visitor-1';

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
    mockGetUserSettings.mockResolvedValue({});
    mockReserveShareVisitorTurn.mockResolvedValue({ id: 'msg-1' });
    mockResolveAttachmentsByFileIds.mockResolvedValue({
      audioList: [],
      fileList: [],
      imageList: [{ alt: 'cat.png', id: 'file-visitor', url: 'https://s3/cat.png' }],
      orderedFileIds: ['file-visitor'],
      videoList: [],
      warnings: [],
    });
    service = new AiAgentService(mockDb, creatorId);
  });

  it('resolves attachments under the CREATOR on a normal run', async () => {
    await service.execAgent({ agentId: 'agent-1', fileIds: ['file-own'], prompt: 'Hello' });

    expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: ['file-own'], userId: creatorId }),
    );
  });

  it('resolves attachments under the CREATOR on a share-visitor run too, and attaches them to the turn', async () => {
    // Share uploads are creator-owned rows (`shareChat.createFile` writes them
    // under the creator with share provenance), so the run resolves them in
    // the same scope it executes in — never under the visitor, whose own
    // account holds no share files at all.
    await service.execAgent({
      agentId: 'agent-1',
      fileIds: ['file-visitor'],
      prompt: 'Hello',
      shareGate: {
        agentId: 'agent-1',
        shareConfig: { toolGrants: [] },
        shareId: 'share-1',
        visitorUserId: visitorId,
      },
    });

    expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: ['file-visitor'], userId: creatorId }),
    );
    expect(mockResolveAttachmentsByFileIds).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: visitorId }),
    );
    // The resolved ids are stamped on the visitor's user message row (persisted
    // under the creator via the turn reservation), so the message-file
    // relation exists for the visitor's own read-back.
    expect(mockReserveShareVisitorTurn).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: creatorId }),
      expect.objectContaining({ files: ['file-visitor'], role: 'user' }),
      undefined,
    );
    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
  });
});
