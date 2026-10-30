import type { GatewayMuxClient, OperationClient } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { messageService } from '@/services/message';
import * as serverConfigStore from '@/store/serverConfig';

import { GatewayActionImpl } from '../transports/gateway/gateway';
import { resetGatewayMuxRegistry } from '../transports/gateway/muxRegistry';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execAgentTask: vi.fn(),
    interruptTask: vi.fn(),
    issueGatewayUserToken: vi.fn(),
    refreshGatewayToken: vi.fn(),
  },
}));

vi.mock('@/services/shareChat', () => ({
  shareChatService: {
    execAgentTask: vi.fn(),
    interruptTask: vi.fn(),
    issueGatewayUserToken: vi.fn(),
    refreshGatewayToken: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: { getMessages: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/services/topic', () => ({
  topicService: {
    getTopicDetail: vi.fn().mockResolvedValue(null),
    settleRunningOperation: vi.fn().mockResolvedValue(undefined),
    updateTopicMetadata: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/store/file/store', () => ({
  getFileStoreState: () => ({ moveChatContextSelections: vi.fn() }),
}));

/** The two server-side halves the transport requires: capability + rollout. */
const mockServer = vi.hoisted(() => ({ agentGatewayProtocol: 2 as 1 | 2, enableGatewayMux: true }));
const mockUserState = vi.hoisted(() => ({
  profile: { id: 'user-1' },
  workspaceUserPreference: { agentDeviceOverrides: {} as Record<string, any> },
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: vi.fn(() => mockUserState),
  useUserStore: { getState: vi.fn(() => mockUserState) },
}));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: { defaultAgentConfig: () => ({ chatConfig: {} }) },
  toolInterventionSelectors: { allowList: () => [], approvalMode: () => 'manual' },
  userGeneralSettingsSelectors: { telemetry: () => false },
  userProfileSelectors: { userId: (state: typeof mockUserState) => state.profile.id },
}));

vi.mock('@/const/version', async (importOriginal) => ({
  ...(await importOriginal<typeof ConstVersion>()),
  isDesktop: false,
}));

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: vi.fn() },
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({ activeAgentId: undefined, agentMap: {} }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => undefined,
    getAgentById: () => () => undefined,
  },
  agentSelectors: {
    currentAgentWorkingDirectory: () => () => undefined,
    getAgentConfigById: () => () => undefined,
  },
  chatConfigByIdSelectors: {
    getChatConfigById: () => () => ({}),
    isChatModeById: () => () => false,
    isLocalSystemEnabledById: () => () => false,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ topicDataMap: {}, topicDetailMap: {} }) },
}));

// ─── Fakes ───

type Emitter = { emit: (event: string, ...args: any[]) => void };

function createListenerBag() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const on = vi.fn((event: string, listener: (...args: any[]) => void) => {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  });
  const emit = (event: string, ...args: any[]) => {
    listeners.get(event)?.forEach((listener) => listener(...args));
  };
  return { emit, on };
}

/** v1-shaped client the injected `createClient` seam returns (flag off). */
function createMockV1Client() {
  const { emit, on } = createListenerBag();
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit,
    on,
    reconnect: vi.fn(async () => {}),
    sendToolResult: vi.fn(() => true),
    updateToken: vi.fn(),
  };
}

/** Adapter-shaped client the injected `createMuxClient` seam returns (flag on). */
function createMockOperationClient(): OperationClient & Emitter {
  const { emit, on } = createListenerBag();
  return {
    connect: vi.fn(),
    connectionStatus: 'disconnected',
    disconnect: vi.fn(),
    emit,
    lastEventId: '',
    on: on as OperationClient['on'],
    reconnect: vi.fn(async () => {}),
    sendToolResult: vi.fn(() => true),
    updateToken: vi.fn(),
  };
}

function createFakeMux(): GatewayMuxClient & Emitter {
  const { emit, on } = createListenerBag();
  return {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    emit,
    on,
    status: 'disconnected',
    subscribe: vi.fn(),
    takePendingToolResults: vi.fn(() => []),
  } as unknown as GatewayMuxClient & Emitter;
}

const GATEWAY_URL = 'https://gateway.test.com';

function createTestAction(overrides: Record<string, any> = {}) {
  const state: Record<string, any> = {
    gatewayConnections: {},
    gatewayFeed: {},
    operations: {},
    operationsByContext: {},
  };
  const set = vi.fn((updater: any) => {
    if (typeof updater === 'function') Object.assign(state, updater(state));
    else Object.assign(state, updater);
  });
  const get = vi.fn(() => ({ ...state, ...overrides })) as any;
  const action = new GatewayActionImpl(set as any, get, undefined);

  const v1Client = createMockV1Client();
  action.createClient = vi.fn(() => v1Client);
  const muxClient = createMockOperationClient();
  action.createMuxClient = vi.fn(() => muxClient);
  const mux = createFakeMux();
  action.resolveGatewayMux = vi.fn(() => mux);

  return { action, get, mux, muxClient, set, state, v1Client };
}

describe('GatewayActionImpl (multiplexed gateway transport)', () => {
  beforeEach(() => {
    mockServer.agentGatewayProtocol = 2;
    mockServer.enableGatewayMux = true;
    (globalThis as any).window = {
      global_serverConfigStore: {
        getState: () => ({
          featureFlags: { enableGatewayMux: mockServer.enableGatewayMux },
          serverConfig: {
            agentGatewayProtocol: mockServer.agentGatewayProtocol,
            agentGatewayUrl: GATEWAY_URL,
            enableGatewayMode: true,
          },
        }),
      },
    };
    // The conversation read resolves Gateway mode from this store too.
    vi.spyOn(serverConfigStore, 'getServerConfigStoreState').mockReturnValue({
      featureFlags: { enableGatewayMux: mockServer.enableGatewayMux },
      serverConfig: {
        agentGatewayProtocol: mockServer.agentGatewayProtocol,
        agentGatewayUrl: GATEWAY_URL,
        enableGatewayMode: true,
      },
    } as unknown as ReturnType<typeof serverConfigStore.getServerConfigStoreState>);
    vi.mocked(messageService.getMessages).mockClear();
  });

  afterEach(() => {
    resetGatewayMuxRegistry();
    delete (globalThis as any).window;
    vi.restoreAllMocks();
  });

  describe('runs this tab did not start', () => {
    const setup = () => {
      const refreshTopic = vi.fn().mockResolvedValue(undefined);
      const refreshMessages = vi.fn().mockResolvedValue(undefined);
      const refreshThreads = vi.fn().mockResolvedValue(undefined);
      const test = createTestAction({ refreshMessages, refreshThreads, refreshTopic });
      // Attach the feed through a live connection, as a real run would.
      test.action.connectToGateway({
        gatewayUrl: GATEWAY_URL,
        operationId: 'own-op',
        token: 'tok',
        topicId: 'topic-1',
      });
      test.state.gatewayConnections = { 'own-op': { status: 'connected' } };
      return { ...test, refreshMessages, refreshThreads, refreshTopic };
    };

    const lifecycle = (operationId: string, status: string, meta?: Record<string, string>) => ({
      at: Date.now(),
      meta,
      operationId,
      status,
      type: 'op_lifecycle',
    });

    // A background sub-agent's result wakes its parent with a run the server
    // starts on its own; refetching the topic lands its running marker, which
    // the conversation's reconnect hook attaches to.
    it('refetches the topic when a top-level run starts elsewhere, once per transition', () => {
      const { mux, refreshTopic } = setup();

      const wake = lifecycle('wake-op', 'running', { agentId: 'agent-1', topicId: 'topic-1' });
      mux.emit('lifecycle', wake);
      mux.emit('lifecycle', { ...wake, at: wake.at + 1 });

      expect(refreshTopic).toHaveBeenCalledTimes(1);
      expect(refreshTopic).toHaveBeenCalledWith(expect.stringContaining('agent-1'));
    });

    it('ignores runs this tab is already streaming and runs without a topic', () => {
      const { mux, refreshTopic } = setup();

      mux.emit('lifecycle', lifecycle('own-op', 'running', { agentId: 'a', topicId: 'topic-1' }));
      mux.emit('lifecycle', lifecycle('bare-op', 'running', { agentId: 'a' }));

      expect(refreshTopic).not.toHaveBeenCalled();
    });

    // The result card's thread link and the right panel's sub-agent list read
    // the topic's thread list, which a live wake would otherwise leave stale.
    it('refetches the topic threads when a background child starts', () => {
      const { mux, refreshThreads } = setup();

      mux.emit(
        'lifecycle',
        lifecycle('bg-child', 'running', {
          agentId: 'a',
          parentOperationId: 'gone-parent',
          topicId: 'topic-1',
        }),
      );

      expect(refreshThreads).toHaveBeenCalledWith('topic-1');
    });

    it('does not refetch the topic for a child run starting', () => {
      const { mux, refreshTopic } = setup();

      mux.emit(
        'lifecycle',
        lifecycle('child-op', 'running', {
          agentId: 'a',
          parentOperationId: 'gone-parent',
          topicId: 'topic-1',
        }),
      );

      expect(refreshTopic).not.toHaveBeenCalled();
    });

    it('refetches messages when a child ends after its parent stopped streaming', () => {
      const { mux, refreshMessages, refreshThreads } = setup();
      const meta = { agentId: 'a', parentOperationId: 'gone-parent', topicId: 'topic-1' };

      mux.emit('lifecycle', lifecycle('bg-child', 'running', meta));
      mux.emit('lifecycle', lifecycle('bg-child', 'completed', meta));

      expect(refreshMessages).toHaveBeenCalledWith({ agentId: 'a', topicId: 'topic-1' });
      expect(refreshThreads).toHaveBeenLastCalledWith('topic-1');
    });

    // The parent's stream carries the answer but not the topic's thread list.
    it('refreshes only the threads for a child whose parent streams here', () => {
      const { mux, refreshMessages, refreshThreads } = setup();

      mux.emit(
        'lifecycle',
        lifecycle('fg-child', 'completed', {
          agentId: 'a',
          parentOperationId: 'own-op',
          topicId: 'topic-1',
        }),
      );

      expect(refreshMessages).not.toHaveBeenCalled();
      expect(refreshThreads).toHaveBeenCalledWith('topic-1');
    });

    // A run this tab just started is announced before its connection exists;
    // following it opened a second resuming stream and left the spinner on.
    it('does not follow a run while this tab has a turn going on the topic', () => {
      const { mux, refreshTopic, state } = setup();
      state.operationsByContext = { main_a_topic_1: ['local-send'] };
      state.operations = {
        'local-send': {
          context: { agentId: 'a', scope: 'main', threadId: null, topicId: 'topic_1' },
          id: 'local-send',
          metadata: {},
          status: 'running',
          type: 'sendMessage',
        },
      };

      mux.emit('lifecycle', lifecycle('new-op', 'running', { agentId: 'a', topicId: 'topic_1' }));
      mux.emit('lifecycle', lifecycle('new-op', 'completed', { agentId: 'a', topicId: 'topic_1' }));

      expect(refreshTopic).not.toHaveBeenCalled();
    });

    // The running notice can beat the topic's running marker, and a short
    // wake-up can end before anything refetches; its end converges the view.
    it('refetches messages and the topic when a top-level run ends elsewhere', () => {
      const { mux, refreshMessages, refreshTopic } = setup();
      const meta = { agentId: 'a', topicId: 'topic-1' };

      mux.emit('lifecycle', lifecycle('wake-op', 'completed', meta));

      expect(refreshMessages).toHaveBeenCalledWith({ agentId: 'a', topicId: 'topic-1' });
      expect(refreshTopic).toHaveBeenCalledTimes(1);
    });
  });
});
