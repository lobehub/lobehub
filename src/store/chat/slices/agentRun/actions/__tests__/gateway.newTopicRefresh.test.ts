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

describe('GatewayActionImpl new topic refresh', () => {
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

  afterEach(() => {
    delete (globalThis as any).window;
  });

  // A project home is not the agent's page: refreshing the active bucket left
  // the new row without the environment the server applied until a reload.
  it("refreshes the new topic's own list, not the page's, after the server creates it", async () => {
    const { action, refreshTopic, state } = createExecuteTestAction();
    state.activeAgentId = 'page-agent';

    vi.mocked(aiAgentService.execAgentTask).mockResolvedValue({
      agentId: 'agent-1',
      assistantMessageId: 'ast-1',
      autoStarted: true,
      createdAt: new Date().toISOString(),
      message: 'ok',
      operationId: 'server-op-1',
      status: 'created',
      success: true,
      timestamp: new Date().toISOString(),
      token: 'test-token',
      topicId: 'topic-created',
      userMessageId: 'usr-1',
    });

    await action.executeGatewayAgent({
      context: { agentId: 'agent-1', threadId: null, topicId: null },
      message: 'Hello',
    });

    expect(refreshTopic).toHaveBeenCalledWith('agent_agent-1');
  });
});
