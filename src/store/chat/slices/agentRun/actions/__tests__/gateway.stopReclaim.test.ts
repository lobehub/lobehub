import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { aiAgentService, type ExecAgentResult } from '@/services/aiAgent';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

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

/** Start a Gateway run and return its registered cancel hook. */
const startRun = async (
  interrupt: { deviceCancellationConfirmed?: boolean },
  stoppedApproval?: ExecAgentResult,
) => {
  const onOperationCancel = vi.fn();
  const state: Record<string, any> = { gatewayConnections: {}, topicDataMap: {} };
  const set = vi.fn((updater: any) => {
    Object.assign(state, typeof updater === 'function' ? updater(state) : updater);
  });
  const get = vi.fn(() => ({
    ...state,
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    connectToGateway: vi.fn(),
    getOperationAbortSignal: vi.fn(() => AbortSignal.abort()),
    internal_pinTopicStatus: vi.fn(),
    internal_dispatchTopic: vi.fn(),
    moveQueuedMessages: vi.fn(),
    moveVoiceMessages: vi.fn(),
    onOperationCancel,
    replaceMessages: vi.fn(),
    startOperation: vi.fn(() => ({ operationId: 'gw-op-local' })),
    switchTopic: vi.fn(),
  })) as any;
  (globalThis as any).window = {
    global_serverConfigStore: {
      getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
    },
  };
  const action = new GatewayActionImpl(set as any, get, undefined);
  action.createClient = vi.fn(() => createMockClient());
  vi.mocked(aiAgentService.interruptTask).mockResolvedValue({
    ...interrupt,
    operationId: 'server-op',
    success: true,
  });
  vi.mocked(aiAgentService.execAgentTask).mockResolvedValue(serverResult);

  if (stoppedApproval) {
    await action.executeGatewayAgent({
      context,
      message: '',
      parentMessageId: 'tool-1',
      parentOperationId: 'approve-op',
      precreatedResult: stoppedApproval,
    });
    return { get, handler: undefined as never };
  }
  await action.executeGatewayAgent({ context, message: 'Hello' });
  const [, handler] = onOperationCancel.mock.calls[0];
  return { get, handler: handler as () => Promise<void> };
};

describe('stopping a Gateway run', () => {
  // ROOT CAUSE:
  //
  // A stopped run starts nothing next, yet the follow-ups this client had
  // handed to the server queue stayed there: the tray kept them as the
  // server's, and the next run would have joined them unasked.
  //
  // Before: the cancel hook only interrupted the run.
  // After: once the stop is confirmed, the follow-ups come back to this client.
  it('takes the follow-ups queued on the server back once the stop is confirmed', async () => {
    const { get, handler } = await startRun({});
    await handler();

    expect(reclaimServerQueuedMessages).toHaveBeenCalledWith(get, messageMapKey(context));
  });

  it('keeps them on the server when the stop is not confirmed', async () => {
    const { handler } = await startRun({ deviceCancellationConfirmed: false });
    await expect(handler()).rejects.toThrow();

    expect(reclaimServerQueuedMessages).not.toHaveBeenCalled();
  });

  // ROOT CAUSE:
  //
  // Approving a tool claims it on the server, which already starts the resumed
  // run. A Stop pressed while that claim was in flight made the run start
  // throw before it looked at the precreated run, so the run kept going.
  //
  // Before: an aborted start abandoned the precreated run.
  // After: it falls through to the late interrupt, which stops that run.
  it('interrupts the run an approval claim already started', async () => {
    await startRun({}, { ...serverResult, operationId: 'claimed-op' });

    expect(aiAgentService.execAgentTask).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(aiAgentService.interruptTask).toHaveBeenCalledWith({
        operationId: 'claimed-op',
        topicId: 'topic-1',
      }),
    );
  });
});
