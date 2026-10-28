import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { aiAgentService, type ExecAgentResult } from '@/services/aiAgent';
import { topicService } from '@/services/topic';

import type { GatewayConnection } from '../transports/gateway/gateway';
import { GatewayActionImpl } from '../transports/gateway/gateway';

const reclaimServerQueuedMessages = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../transports/gateway/serverSteerQueue', () => ({
  restoreServerQueuedMessages: vi.fn(),
  reclaimServerQueuedMessages,
  withdrawQueuedMessage: vi.fn(),
}));

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

const moveChatContextSelections = vi.hoisted(() => vi.fn());
vi.mock('@/store/file/store', () => ({
  getFileStoreState: () => ({ moveChatContextSelections }),
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
  // Lab flag off: this suite pins the v1 per-operation socket path.
  labPreferSelectors: { enableGatewayMux: () => false },
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

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as any).window;
});

/**
 * Start a Claude Code run whose topic row is optimistically `running`, then end
 * its session without the run's own terminal frame — the shape a run takes when
 * the server failed its device dispatch before the CLI wrote anything.
 */
const endExternalRunWithoutTerminal = async (activeTopicId = 'topic-1') => {
  const connectToGateway = vi.fn();
  const completeOperation = vi.fn();
  const internalDispatchTopic = vi.fn();
  const internalPinTopicStatus = vi.fn();
  const state: Record<string, any> = {
    activeAgentId: 'agent-1',
    activeTopicId,
    gatewayConnections: {},
    operations: {},
    topicDataMap: {
      'agent_agent-1': {
        items: [
          {
            id: 'topic-1',
            metadata: {
              runningOperation: { assistantMessageId: 'ast-1', operationId: 'server-op' },
            },
            status: 'running',
          },
        ],
      },
    },
  };
  const set = vi.fn((updater: any) => {
    Object.assign(state, typeof updater === 'function' ? updater(state) : updater);
  });
  const get = vi.fn(() => ({
    ...state,
    associateMessageWithOperation: vi.fn(),
    completeOperation,
    connectToGateway,
    internal_dispatchTopic: internalDispatchTopic,
    internal_pinTopicStatus: internalPinTopicStatus,
    moveQueuedMessages: vi.fn(),
    moveVoiceMessages: vi.fn(),
    onOperationCancel: vi.fn(),
    refreshTopicDetail: vi.fn().mockResolvedValue(undefined),
    startOperation: vi.fn(() => ({ operationId: 'gw-op' })),
    updateTopicStatus: vi.fn(),
  })) as any;

  (globalThis as any).window = {
    global_serverConfigStore: {
      getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
    },
  };

  const action = new GatewayActionImpl(set as any, get, undefined);
  action.createClient = vi.fn(() => createMockClient());
  vi.mocked(aiAgentService.execAgentTask).mockResolvedValue({
    ...serverResult,
    heteroType: 'claude-code',
  });

  await action.executeGatewayAgent({ context, message: 'Hello' });

  const { onSessionComplete } = connectToGateway.mock.calls[0][0];
  internalDispatchTopic.mockClear();
  internalPinTopicStatus.mockClear();
  onSessionComplete({
    authFailed: false,
    completion: { source: 'resume_status', status: 'error' },
    succeeded: false,
    terminalReceived: false,
  });
  // Let the server read and the local retire settle.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return { completeOperation, internalDispatchTopic, internalPinTopicStatus };
};

const context = { agentId: 'agent-1', scope: 'main' as const, threadId: null, topicId: 'topic-1' };

const serverResult: ExecAgentResult = {
  agentId: 'agent-1',
  assistantMessageId: 'ast-1',
  autoStarted: true,
  createdAt: new Date().toISOString(),
  message: 'ok',
  operationId: 'server-op',
  status: 'created',
  success: true,
  timestamp: new Date().toISOString(),
  token: 'test-token',
  topicId: 'topic-1',
  userMessageId: 'usr-1',
};

describe('external producer session ending without its terminal', () => {
  it('retires the local running row once the server no longer backs the run', async () => {
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: 'topic-1',
      metadata: { lastSettledOperationId: 'server-op', runningOperation: null },
      status: 'active',
    } as any);

    const run = await endExternalRunWithoutTerminal();

    expect(run.completeOperation).toHaveBeenCalledWith('gw-op');
    // The row stops spinning…
    expect(run.internalPinTopicStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', topicId: 'topic-1' }),
    );
    expect(run.internalDispatchTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'topic-1',
        value: { metadata: expect.objectContaining({ runningOperation: null }) },
      }),
    );
    // …without the transport settling a producer it cannot see.
    expect(topicService.settleRunningOperation).not.toHaveBeenCalled();
  });

  it("mirrors the server's terminal status for a topic the user is not watching", async () => {
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: 'topic-1',
      metadata: {},
      status: 'unread',
    } as any);

    const run = await endExternalRunWithoutTerminal('another-topic');

    expect(run.internalPinTopicStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unread', topicId: 'topic-1' }),
    );
  });

  it('keeps the row running while the server still backs the CLI', async () => {
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: 'topic-1',
      metadata: { runningOperation: { operationId: 'server-op' } },
      status: 'running',
    } as any);

    const run = await endExternalRunWithoutTerminal();

    expect(run.internalPinTopicStatus).not.toHaveBeenCalled();
    expect(run.internalDispatchTopic).not.toHaveBeenCalled();
    expect(topicService.settleRunningOperation).not.toHaveBeenCalled();
  });

  it('keeps the row running when the server row cannot be read', async () => {
    vi.mocked(topicService.getTopicDetail).mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const run = await endExternalRunWithoutTerminal();

    expect(run.internalPinTopicStatus).not.toHaveBeenCalled();
    expect(run.internalDispatchTopic).not.toHaveBeenCalled();
  });
});

describe('a run the server failed at dispatch', () => {
  it('never marks the topic running or opens a gateway socket', async () => {
    const connectToGateway = vi.fn();
    const completeOperation = vi.fn();
    const updateTopicStatus = vi.fn();
    const replaceMessages = vi.fn();
    const state: Record<string, any> = {
      activeAgentId: 'agent-1',
      activeTopicId: 'topic-1',
      gatewayConnections: {},
      operations: {},
      topicDataMap: {},
    };
    const set = vi.fn((updater: any) => {
      Object.assign(state, typeof updater === 'function' ? updater(state) : updater);
    });
    const get = vi.fn(() => ({
      ...state,
      associateMessageWithOperation: vi.fn(),
      completeOperation,
      connectToGateway,
      getOperationAbortSignal: vi.fn(() => new AbortController().signal),
      internal_dispatchTopic: vi.fn(),
      internal_pinTopicStatus: vi.fn(),
      moveQueuedMessages: vi.fn(),
      moveVoiceMessages: vi.fn(),
      onOperationCancel: vi.fn(),
      replaceMessages,
      startOperation: vi.fn(() => ({ operationId: 'gw-op' })),
      updateTopicStatus,
    })) as any;
    (globalThis as any).window = {
      global_serverConfigStore: {
        getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
      },
    };

    const action = new GatewayActionImpl(set as any, get, undefined);
    action.createClient = vi.fn(() => createMockClient());
    // A device dispatch the server refused: it already wrote the error bubble and
    // settled the topic before answering, and there is no gateway token.
    vi.mocked(aiAgentService.execAgentTask).mockResolvedValue({
      ...serverResult,
      autoStarted: false,
      error: 'DEVICE_OFFLINE',
      heteroType: 'claude-code',
      status: 'error',
      success: false,
      token: undefined,
    } as any);

    await action.executeGatewayAgent({
      context,
      message: 'Hello',
      parentOperationId: 'send-op',
    } as any);

    expect(updateTopicStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
    );
    expect(connectToGateway).not.toHaveBeenCalled();
    expect(completeOperation).toHaveBeenCalledWith('send-op');
    // The server's error bubble is pulled in, since no stream will deliver it.
    expect(replaceMessages).toHaveBeenCalled();
  });
});
