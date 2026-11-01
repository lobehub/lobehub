import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';
import { RequestedDeviceIgnoredError } from '../pipeline/turnSetup';

const {
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockMessageCreate,
  mockMessageUpdate,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  mockMessageCreate: vi.fn(),
  mockMessageUpdate: vi.fn(),
}));

const { mockDeviceProxy } = vi.hoisted(() => ({
  mockDeviceProxy: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
    queryDeviceSystemInfo: vi.fn().mockResolvedValue(undefined),
    // Present so a send-path regression that probes the device shows up as a
    // failed assertion rather than a "not a function" crash.
    statPath: vi.fn().mockResolvedValue({ exists: true, isDirectory: true }),
  },
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
      update: mockMessageUpdate,
    };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        files: [],
        id: 'agent-1',
        knowledgeBases: [],
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      }),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        files: [],
        id: 'agent-1',
        knowledgeBases: [],
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      }),
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

const topicMock = {
  create: vi.fn().mockResolvedValue({ id: 'topic-1', metadata: undefined }),
  findById: vi.fn().mockResolvedValue(undefined),
  releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
  tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
  updateMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return topicMock;
  }),
}));

const { mockResolveProjectDirectory, mockResolveProjectDirectoryForTopic } = vi.hoisted(() => ({
  mockResolveProjectDirectory: vi.fn(),
  mockResolveProjectDirectoryForTopic: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/database/models/projectWorkingDirectory', () => ({
  ProjectWorkingDirectoryModel: vi.fn().mockImplementation(function () {
    return {
      resolve: mockResolveProjectDirectory,
      resolveForTopic: mockResolveProjectDirectoryForTopic,
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
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: mockDeviceProxy,
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

describe('AiAgentService.execAgent - required device', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    topicMock.updateMetadata.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockMessageUpdate.mockResolvedValue({});
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    // Reset device proxy state
    mockDeviceProxy.isConfigured = false;
    mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const onlineDevice = {
    deviceId: 'device-001',
    hostname: 'my-laptop',
    lastSeen: '2026-03-06T12:00:00.000Z',
    online: true,
    platform: 'linux' as const,
  };

  const onlineDevice2 = {
    deviceId: 'device-002',
    hostname: 'my-desktop',
    lastSeen: '2026-03-06T12:00:00.000Z',
    online: true,
    platform: 'darwin' as const,
  };

  // Override the agent's agencyConfig and rebuild the service. Auto-activation
  // is now exclusive to `executionTarget: 'auto'` — the default (`local`) never
  // grabs a device — so the auto-activation specs opt in explicitly.
  const useAgencyConfig = async (agencyConfig: Record<string, unknown>) => {
    const { AgentService } = await import('@/server/services/agent');
    vi.mocked(AgentService).mockImplementation(function () {
      return {
        getAgentConfig: vi.fn().mockResolvedValue({
          agencyConfig,
          chatConfig: {},
          files: [],
          id: 'agent-1',
          knowledgeBases: [],
          model: 'gpt-4',
          plugins: [],
          provider: 'openai',
          systemRole: 'You are a helpful assistant',
        }),
      } as any;
    });
    service = new AiAgentService(mockDb, userId);
  };

  // ROOT CAUSE:
  //
  // `lh topic send --new --device` reported a send to the requested machine
  // while a fixed execution target dropped that device and ran the work
  // elsewhere. Only the server knows the caller's effective policy (owners and
  // private agents have the fixed policy lifted), so the refusal lives here.
  //
  // Before: a required device was silently overridden by a fixed target.
  // After: `requireDevice` refuses before anything is created.
  describe('a required device', () => {
    const requireDevice = (deviceId: string) =>
      service.execAgent({
        agentId: 'agent-1',
        deviceId,
        prompt: 'Run a command',
        requireDevice: true,
      });

    it('is refused when a fixed device target would drop it, creating nothing', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);
      await useAgencyConfig({
        boundDeviceId: 'device-001',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      });
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

      await expect(requireDevice('device-002')).rejects.toBeInstanceOf(RequestedDeviceIgnoredError);
      expect(mockCreateOperation).not.toHaveBeenCalled();
      expect(topicMock.create).not.toHaveBeenCalled();
    });

    it('is refused by a fixed sandbox target', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      await useAgencyConfig({
        executionTarget: 'sandbox',
        executionTargetSelectionPolicy: 'fixed',
      });
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

      await expect(requireDevice('device-001')).rejects.toBeInstanceOf(RequestedDeviceIgnoredError);
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('runs when the fixed target is that same device', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      await useAgencyConfig({
        boundDeviceId: 'device-001',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      });
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

      await requireDevice('device-001');

      expect(mockCreateOperation.mock.calls[0][0].activeDeviceId).toBe('device-001');
    });

    // ROOT CAUSE:
    //
    // The CLI checks the device is online, but it can drop before the server
    // routes the run; a non-fixed agent then degraded to the cloud sandbox and
    // ran the work there.
    //
    // Before: an unrouted required device silently fell back to the sandbox.
    // After: the run fails before any operation starts.
    it('fails before operation creation when the required device went offline', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice2]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await expect(requireDevice('device-001')).rejects.toMatchObject({
        cause: { data: { code: 'DEVICE_NOT_FOUND', deviceId: 'device-001' } },
        code: 'PRECONDITION_FAILED',
      });

      expect(mockCreateOperation).not.toHaveBeenCalled();
      expect(mockMessageUpdate).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({
          error: expect.objectContaining({ message: 'Required device unavailable' }),
        }),
      );
    });

    it('still lets a device that is only preferred fall back when it is offline', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice2]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        deviceId: 'device-001',
        prompt: 'Run a command',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
    });

    it('runs on the requested device when the effective policy is not fixed (e.g. lifted for a manager)', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);
      // What `resolveAgentAgencyConfig` leaves for a managing caller: the
      // stored device target without the fixed selection policy.
      await useAgencyConfig({ boundDeviceId: 'device-001', executionTarget: 'device' });
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

      await requireDevice('device-002');

      expect(mockCreateOperation.mock.calls[0][0].activeDeviceId).toBe('device-002');
    });
  });
});
