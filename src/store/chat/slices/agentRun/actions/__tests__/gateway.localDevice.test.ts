import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { aiAgentService } from '@/services/aiAgent';

import type { GatewayConnection } from '../transports/gateway/gateway';
import { GatewayActionImpl } from '../transports/gateway/gateway';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execAgentTask: vi.fn(),
    interruptTask: vi.fn(),
    refreshGatewayToken: vi.fn(),
  },
}));

vi.mock('@/services/shareChat', () => ({
  shareChatService: {
    execAgentTask: vi.fn(),
    getTopics: vi.fn().mockResolvedValue([]),
    interruptTask: vi.fn(),
    refreshGatewayToken: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/topic', () => ({
  topicService: {
    // Defaults to "no detail readable" so the silent-end reconcile stays
    // fail-safe unless a test opts in by returning a row.
    getTopicDetail: vi.fn().mockResolvedValue(null),
    settleRunningOperation: vi.fn().mockResolvedValue(undefined),
    updateTopicMetadata: vi.fn().mockResolvedValue(undefined),
  },
}));

const moveChatComposerAttachments = vi.hoisted(() => vi.fn());
vi.mock('@/store/file/store', () => ({
  getFileStoreState: () => ({ moveChatComposerAttachments }),
}));

const mockUserDefaultConfig = vi.hoisted(() => ({
  disableGatewayMode: undefined as boolean | undefined,
}));
const mockToolInterventionConfig = vi.hoisted(() => ({
  allowList: [] as string[],
  approvalMode: 'manual' as 'allow-list' | 'auto-run' | 'manual',
}));
const mockUserState = vi.hoisted(() => ({
  profile: { id: 'user-1' },
  workspaceUserPreference: { agentDeviceOverrides: {} as Record<string, any> },
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: vi.fn(() => mockUserState),
  },
}));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: {
    defaultAgentConfig: () => ({
      chatConfig: { disableGatewayMode: mockUserDefaultConfig.disableGatewayMode },
    }),
  },
  toolInterventionSelectors: {
    allowList: () => mockToolInterventionConfig.allowList,
    approvalMode: () => mockToolInterventionConfig.approvalMode,
  },
  userProfileSelectors: {
    userId: (state: typeof mockUserState) => state.profile.id,
  },
}));

// ─── Local-device activation (本机) test seams ───
// Controlled per-test; default off so the rest of the suite runs as web (no
// device resolution, no electron IPC).
const mockEnv = vi.hoisted(() => ({ isDesktop: false }));
const mockGateway = vi.hoisted(() => ({ getDeviceInfo: vi.fn() }));
// Effective runtime mode === 'local' (what isLocalSystemEnabledById returns)
// and chat mode (what isChatModeById returns).
const mockRuntime = vi.hoisted(() => ({ isChatMode: false, isLocal: false }));
const mockAgentStore = vi.hoisted(() => ({
  state: { activeAgentId: undefined, agentMap: {} } as any,
}));

vi.mock('@/const/version', async (importOriginal) => {
  const actual = await importOriginal<typeof ConstVersion>();
  return {
    ...actual,
    get isDesktop() {
      return mockEnv.isDesktop;
    },
  };
});

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: mockGateway.getDeviceInfo },
}));

vi.mock('@/store/agent', () => ({ getAgentStoreState: () => mockAgentStore.state }));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: (agentId: string) => (state: any) =>
      state.agentMap?.[agentId]?.agencyConfig,
    getAgentModelById: (agentId: string) => (state: any) => state.agentMap?.[agentId]?.model ?? '',
    getAgentById: (agentId: string) => (state: any) => state.agentMap?.[agentId],
  },
  agentSelectors: { currentAgentWorkingDirectory: () => () => undefined },
  chatConfigByIdSelectors: {
    getChatConfigById: (agentId: string) => (state: any) =>
      state.agentMap?.[agentId]?.chatConfig ?? {},
    isChatModeById: () => () => mockRuntime.isChatMode,
    isLocalSystemEnabledById: () => () => mockRuntime.isLocal,
  },
}));

// ─── Mock Client Factory ───

function createMockClient(): GatewayConnection['client'] & {
  emitEvent: (event: string, ...args: any[]) => void;
} {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();

  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    emitEvent(event: string, ...args: any[]) {
      listeners.get(event)?.forEach((listener) => listener(...args));
    },
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
    }),
    reconnect: vi.fn(async () => {}),
    sendToolResult: vi.fn(() => true),
    updateToken: vi.fn(),
  };
}

describe('GatewayActionImpl · local device activation (本机)', () => {
  beforeEach(() => {
    mockEnv.isDesktop = false;
    mockRuntime.isLocal = false;
    mockRuntime.isChatMode = false;
    mockAgentStore.state = { activeAgentId: undefined, agentMap: {} };
    mockUserState.workspaceUserPreference.agentDeviceOverrides = {};
    mockGateway.getDeviceInfo.mockReset();
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  function createExecuteTestAction() {
    const mockClient = createMockClient();
    const moveQueuedMessages = vi.fn();
    const moveVoiceMessages = vi.fn();
    const state: Record<string, any> = { gatewayConnections: {}, topicDataMap: {} };
    const associateMessageWithOperation = vi.fn();
    const connectToGateway = vi.fn();
    const internalDispatchTopic = vi.fn();
    const internalReplaceTopicId = vi.fn();
    const onOperationCancel = vi.fn();
    const replaceMessages = vi.fn();
    const refreshTopic = vi.fn().mockResolvedValue(undefined);
    const refreshTopicDetail = vi.fn().mockResolvedValue(undefined);
    const startOperation = vi.fn(() => ({ operationId: 'gw-op-1' }));
    const switchTopic = vi.fn();
    const updateTopicStatus = vi.fn();
    const set = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        Object.assign(state, updater(state));
      } else {
        Object.assign(state, updater);
      }
    });

    const get = vi.fn(() => ({
      ...state,
      associateMessageWithOperation,
      connectToGateway,
      internal_dispatchTopic: internalDispatchTopic,
      internal_replaceTopicId: internalReplaceTopicId,
      moveQueuedMessages,
      moveVoiceMessages,
      onOperationCancel,
      replaceMessages,
      refreshTopic,
      refreshTopicDetail,
      startOperation,
      switchTopic,
      updateTopicStatus,
    })) as any;

    // Set up window.global_serverConfigStore
    (globalThis as any).window = {
      global_serverConfigStore: {
        getState: () => ({
          serverConfig: { agentGatewayUrl: 'https://gateway.test.com' },
        }),
      },
    };

    const action = new GatewayActionImpl(set as any, get, undefined);
    action.createClient = vi.fn(() => mockClient);

    return {
      action,
      associateMessageWithOperation,
      connectToGateway,
      get,
      internalDispatchTopic,
      internalReplaceTopicId,
      mockClient,
      moveQueuedMessages,
      moveVoiceMessages,
      onOperationCancel,
      replaceMessages,
      refreshTopic,
      refreshTopicDetail,
      set,
      startOperation,
      state,
      switchTopic,
      updateTopicStatus,
    };
  }

  // When the desktop runs against 本机 (effective runtime mode 'local'), the
  // client must forward this machine's own gateway deviceId so the server can
  // preset activeDeviceId and inject lobe-local-system into the first LLM
  // payload — skipping the activateDevice round-trip. It must NOT do so for a
  // cloud/none run, otherwise that run would be wrongly routed to the device.
  describe('local device activation (本机)', () => {
    const successResult = {
      agentId: 'agent-1',
      assistantMessageId: 'ast-1',
      autoStarted: true,
      createdAt: new Date().toISOString(),
      message: 'ok',
      operationId: 'server-op-1',
      status: 'created' as const,
      success: true,
      timestamp: new Date().toISOString(),
      token: 'test-token',
      topicId: 'topic-1',
      userMessageId: 'usr-1',
    };

    afterEach(() => {
      mockEnv.isDesktop = false;
      mockRuntime.isLocal = false;
      mockRuntime.isChatMode = false;
      mockGateway.getDeviceInfo.mockReset();
      mockAgentStore.state.agentMap = {};
      mockUserState.workspaceUserPreference.agentDeviceOverrides = {};
    });

    const send = async () => {
      mockAgentStore.state.agentMap['agent-1'] ??= {
        agencyConfig: { executionTarget: mockRuntime.isLocal ? 'local' : 'sandbox' },
        userId: 'user-1',
      };
      const { action } = createExecuteTestAction();
      vi.mocked(aiAgentService.execAgentTask).mockResolvedValue(successResult);
      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', scope: 'main', threadId: null, topicId: 'topic-1' },
        message: 'list files in cwd',
      });
    };

    it('forwards this desktop as both the route and local capability hint', async () => {
      mockEnv.isDesktop = true;
      mockRuntime.isLocal = true;
      mockGateway.getDeviceInfo.mockResolvedValue({ deviceId: 'device-local-1' });

      await send();

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'device-local-1',
          localDeviceId: 'device-local-1',
        }),
      );
    });

    // Regression guard: an explicit sandbox/none/device target must not
    // preset this machine's deviceId — only a `local` target does.
    it('does not resolve a deviceId when a non-local runtime mode is selected', async () => {
      mockEnv.isDesktop = true;
      mockRuntime.isLocal = false;

      await send();

      expect(mockGateway.getDeviceInfo).not.toHaveBeenCalled();
      expect(vi.mocked(aiAgentService.execAgentTask).mock.calls.at(-1)?.[0]).not.toHaveProperty(
        'deviceId',
      );
    });

    // Regression guard (chat mode → no execution environment): chat mode must
    // not resolve this machine's deviceId even on a local target, otherwise
    // the server presets activeDeviceId and re-injects lobe-local-system.
    it('does not resolve a deviceId in chat mode, even when local mode is set', async () => {
      mockEnv.isDesktop = true;
      mockRuntime.isLocal = true;
      mockRuntime.isChatMode = true;

      await send();

      expect(mockGateway.getDeviceInfo).not.toHaveBeenCalled();
      expect(vi.mocked(aiAgentService.execAgentTask).mock.calls.at(-1)?.[0]).not.toHaveProperty(
        'deviceId',
      );
    });

    it('never resolves a deviceId off desktop, even when local mode is set', async () => {
      mockEnv.isDesktop = false;
      mockRuntime.isLocal = true;

      await send();

      expect(mockGateway.getDeviceInfo).not.toHaveBeenCalled();
      expect(vi.mocked(aiAgentService.execAgentTask).mock.calls.at(-1)?.[0]).not.toHaveProperty(
        'deviceId',
      );
    });

    it('uses a workspace member local override instead of the shared remote device', async () => {
      mockEnv.isDesktop = true;
      mockGateway.getDeviceInfo.mockResolvedValue({ deviceId: 'device-local-member' });
      mockAgentStore.state.agentMap['agent-1'] = {
        agencyConfig: { boundDeviceId: 'workspace-device', executionTarget: 'device' },
        userId: 'workspace-owner',
        visibility: 'public',
        workspaceId: 'workspace-1',
      };
      mockUserState.workspaceUserPreference.agentDeviceOverrides['agent-1'] = {
        boundDeviceId: 'device-local-member',
        executionTarget: 'local',
      };

      await send();

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'device-local-member' }),
      );
    });

    it('does not preset this desktop for a workspace member remote override', async () => {
      mockEnv.isDesktop = true;
      mockAgentStore.state.agentMap['agent-1'] = {
        agencyConfig: { executionTarget: 'local' },
        userId: 'workspace-owner',
        visibility: 'public',
        workspaceId: 'workspace-1',
      };
      mockUserState.workspaceUserPreference.agentDeviceOverrides['agent-1'] = {
        boundDeviceId: 'remote-device',
        executionTarget: 'device',
      };

      await send();

      expect(mockGateway.getDeviceInfo).not.toHaveBeenCalled();
      expect(vi.mocked(aiAgentService.execAgentTask).mock.calls.at(-1)?.[0]).not.toHaveProperty(
        'deviceId',
      );
    });

    it('sends a distinct local device hint for a local platform agent', async () => {
      mockEnv.isDesktop = true;
      mockGateway.getDeviceInfo.mockResolvedValue({ deviceId: 'this-desktop' });
      mockAgentStore.state.agentMap['agent-1'] = {
        agencyConfig: {
          executionTarget: 'local',
          heterogeneousProvider: { type: 'openclaw' },
        },
        userId: 'user-1',
      };

      await send();

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({ localDeviceId: 'this-desktop' }),
      );
      expect(vi.mocked(aiAgentService.execAgentTask).mock.calls.at(-1)?.[0]).not.toHaveProperty(
        'deviceId',
      );
    });

    it('sends a harmless desktop hint without overriding a remote platform target', async () => {
      mockEnv.isDesktop = true;
      mockGateway.getDeviceInfo.mockResolvedValue({ deviceId: 'this-desktop' });
      mockAgentStore.state.agentMap['agent-1'] = {
        agencyConfig: {
          boundDeviceId: 'remote-device',
          executionTarget: 'device',
          heterogeneousProvider: { type: 'hermes' },
        },
        userId: 'user-1',
      };

      await send();

      expect(mockGateway.getDeviceInfo).toHaveBeenCalled();
      const request = vi.mocked(aiAgentService.execAgentTask).mock.calls.at(-1)?.[0];
      expect(request).not.toHaveProperty('deviceId');
      expect(request).toHaveProperty('localDeviceId', 'this-desktop');
    });

    // Regression guard: a legacy agent identified only by `model` (no stored
    // provider yet) must keep this desktop's hints. The `auto` default is
    // driven by `isHetero`, and a provider-only discriminator would let it
    // swallow the hints — sending a Claude Code run to the cloud sandbox.
    it('keeps both desktop hints for a model-only heterogeneous agent', async () => {
      mockEnv.isDesktop = true;
      mockGateway.getDeviceInfo.mockResolvedValue({ deviceId: 'device-local-1' });
      mockAgentStore.state.agentMap['agent-1'] = { model: 'claude-code', userId: 'user-1' };

      await send();

      const request = vi.mocked(aiAgentService.execAgentTask).mock.calls.at(-1)?.[0];
      expect(request).toHaveProperty('deviceId', 'device-local-1');
      expect(request).toHaveProperty('localDeviceId', 'device-local-1');
    });
  });
});
