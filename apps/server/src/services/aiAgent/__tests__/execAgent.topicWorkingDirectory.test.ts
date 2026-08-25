import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

/**
 * A device-bound run resolves its working directory server-side (for
 * `{{workingDirectory}}`, the tool cwd, and the workspace scan) — but the topic
 * it creates has to be PINNED to that directory too, otherwise By-Project files
 * the conversation under "No directory" and every later turn silently re-resolves
 * the agent-level default.
 *
 * This used to happen only inside the heterogeneous device-dispatch branch, so a
 * native agent bound to the very same device left its topics unbound.
 */
const {
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockFindByDeviceId,
  mockGenerateToolsDetailed,
  mockGetAgentConfig,
  mockGetEnabledPluginManifests,
  mockInitWorkspace,
  mockMessageCreate,
  mockPluginQuery,
  mockQueryDeviceList,
  mockTopicFindById,
  mockUpdateDevice,
  mockUpdateTopicMetadata,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn(),
  mockFindByDeviceId: vi.fn(),
  mockGenerateToolsDetailed: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetEnabledPluginManifests: vi.fn(),
  mockInitWorkspace: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockPluginQuery: vi.fn(),
  mockQueryDeviceList: vi.fn(),
  mockTopicFindById: vi.fn(),
  mockUpdateDevice: vi.fn(),
  mockUpdateTopicMetadata: vi.fn(),
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

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(() => ({
    findByDeviceId: mockFindByDeviceId,
    findWorkspaceDeviceById: vi.fn().mockResolvedValue(undefined),
    queryPersonal: vi.fn().mockResolvedValue([]),
    queryWorkspaceDevices: vi.fn().mockResolvedValue([]),
    queryWorkspaceHiddenDeviceIds: vi.fn().mockResolvedValue([]),
    update: mockUpdateDevice,
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: mockGetAgentConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: mockPluginQuery,
    queryAllByConnectorIds: vi.fn().mockResolvedValue([]),
    queryByConnector: vi.fn().mockResolvedValue([]),
    queryByConnectorIds: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: mockTopicFindById,
    releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
    tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
    updateMetadata: mockUpdateTopicMetadata,
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

vi.mock('@/server/modules/Mecha', () => {
  mockGenerateToolsDetailed.mockReturnValue({ enabledToolIds: [], tools: [] });
  mockGetEnabledPluginManifests.mockReturnValue(new Map());
  mockCreateServerAgentToolsEngine.mockReturnValue({
    generateToolsDetailed: mockGenerateToolsDetailed,
    getEnabledPluginManifests: mockGetEnabledPluginManifests,
  });

  return {
    createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
    serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
  };
});

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    initWorkspace: mockInitWorkspace,
    get isConfigured() {
      return true;
    },
    queryDeviceList: mockQueryDeviceList,
    queryDeviceSystemInfo: vi.fn().mockResolvedValue(null),
  },
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

const DEVICE_ID = 'dev-1';
const SOURCE_PATH = '/repo/lobehub';
const WORKTREE_PATH = '/repo/lobehub/.worktrees/feat';

const createAgentConfig = (agencyConfig: Record<string, any>) => ({
  agencyConfig,
  chatConfig: {},
  id: 'agent-1',
  model: 'gpt-4',
  plugins: [],
  provider: 'openai',
  systemRole: '',
});

describe('AiAgentService.execAgent - topic working directory binding', () => {
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
    mockPluginQuery.mockResolvedValue([]);
    mockGenerateToolsDetailed.mockReturnValue({ enabledToolIds: [], tools: [] });
    mockGetEnabledPluginManifests.mockReturnValue(new Map());
    mockQueryDeviceList.mockResolvedValue([
      { deviceId: DEVICE_ID, hostname: 'My Mac', online: true, platform: 'darwin' },
    ]);
    mockFindByDeviceId.mockResolvedValue({ deviceId: DEVICE_ID, workingDirs: [] });
    mockTopicFindById.mockResolvedValue(null);
    mockInitWorkspace.mockResolvedValue({ instructions: [], skills: [] });
    mockUpdateDevice.mockResolvedValue(undefined);
    mockUpdateTopicMetadata.mockResolvedValue(undefined);

    service = new AiAgentService(mockDb, userId);
  });

  it('binds a new topic to the agent per-device working directory', async () => {
    mockGetAgentConfig.mockResolvedValue(
      createAgentConfig({
        boundDeviceId: DEVICE_ID,
        executionTarget: 'device',
        workingDirByDevice: {
          [DEVICE_ID]: {
            git: { activeWorktree: WORKTREE_PATH },
            path: SOURCE_PATH,
            repoType: 'github',
          },
        },
      }),
    );

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    // `workingDirectory` is the EFFECTIVE path the run executes in; the config
    // keeps the SOURCE repo, which is what By-Project groups on.
    expect(mockUpdateTopicMetadata).toHaveBeenCalledWith('topic-1', {
      workingDirectory: WORKTREE_PATH,
      workingDirectoryConfig: {
        git: { activeWorktree: WORKTREE_PATH },
        path: SOURCE_PATH,
        repoType: 'github',
      },
    });
  });

  it('falls back to the bound device default cwd', async () => {
    mockFindByDeviceId.mockResolvedValue({
      defaultCwd: '/repo/default',
      deviceId: DEVICE_ID,
      workingDirs: [],
    });
    mockGetAgentConfig.mockResolvedValue(
      createAgentConfig({ boundDeviceId: DEVICE_ID, executionTarget: 'device' }),
    );

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    expect(mockUpdateTopicMetadata).toHaveBeenCalledWith('topic-1', {
      workingDirectory: '/repo/default',
      workingDirectoryConfig: { path: '/repo/default' },
    });
  });

  it('never rewrites a topic that is already pinned to a directory', async () => {
    // The historical pin is the contract: an old conversation must not follow
    // the agent's current default when that default changes later.
    mockTopicFindById.mockResolvedValue({
      id: 'topic-1',
      metadata: {
        workingDirectory: '/repo/other',
        workingDirectoryConfig: { path: '/repo/other' },
      },
    });
    mockGetAgentConfig.mockResolvedValue(
      createAgentConfig({
        boundDeviceId: DEVICE_ID,
        executionTarget: 'device',
        workingDirByDevice: { [DEVICE_ID]: { path: SOURCE_PATH } },
      }),
    );

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Hello',
    });

    expect(mockUpdateTopicMetadata).not.toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ workingDirectory: expect.anything() }),
    );
  });

  it('leaves the topic unbound when neither the agent nor the device has a directory', async () => {
    mockGetAgentConfig.mockResolvedValue(
      createAgentConfig({ boundDeviceId: DEVICE_ID, executionTarget: 'device' }),
    );

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    expect(mockUpdateTopicMetadata).not.toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ workingDirectory: expect.anything() }),
    );
  });
});
