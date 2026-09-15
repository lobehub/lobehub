import type { GatewayMuxClient, OperationClient } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { aiAgentService } from '@/services/aiAgent';
import { messageService } from '@/services/message';

import { GatewayActionImpl } from '../transports/gateway/gateway';
import { getGatewayMux, resetGatewayMuxRegistry } from '../transports/gateway/muxRegistry';

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
    settleRunningOperation: vi.fn().mockResolvedValue(undefined),
    updateTopicMetadata: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/store/file/store', () => ({
  getFileStoreState: () => ({ moveChatContextSelections: vi.fn() }),
}));

const mockLab = vi.hoisted(() => ({ enableGatewayMux: false }));
const mockUserState = vi.hoisted(() => ({
  profile: { id: 'user-1' },
  workspaceUserPreference: { agentDeviceOverrides: {} as Record<string, any> },
}));

vi.mock('@/store/user', () => ({
  useUserStore: { getState: vi.fn(() => mockUserState) },
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableGatewayMux: () => mockLab.enableGatewayMux },
  settingsSelectors: { defaultAgentConfig: () => ({ chatConfig: {} }) },
  toolInterventionSelectors: { allowList: () => [], approvalMode: () => 'manual' },
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
  agentSelectors: { currentAgentWorkingDirectory: () => () => undefined },
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
    sendInterrupt: vi.fn(),
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
    on: on as OperationClient['on'],
    reconnect: vi.fn(async () => {}),
    sendInterrupt: vi.fn(),
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
  } as unknown as GatewayMuxClient & Emitter;
}

const GATEWAY_URL = 'https://gateway.test.com';

function createTestAction(overrides: Record<string, any> = {}) {
  const state: Record<string, any> = { gatewayConnections: {}, gatewayFeed: {} };
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

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('GatewayActionImpl (enableGatewayMux lab)', () => {
  beforeEach(() => {
    mockLab.enableGatewayMux = true;
    vi.mocked(messageService.getMessages).mockClear();
  });

  afterEach(() => {
    resetGatewayMuxRegistry();
    delete (globalThis as any).window;
    vi.restoreAllMocks();
  });

  describe('connectToGateway', () => {
    it('adapts the operation on the identity mux instead of dialing a v1 socket', () => {
      const { action, mux, muxClient, state, v1Client } = createTestAction();

      action.connectToGateway({
        agentShareId: 'share-1',
        executor: true,
        gatewayUrl: GATEWAY_URL,
        operationId: 'op-1',
        resumeOnConnect: true,
        token: 'unused-in-mux',
        topicId: 'topic-1',
      });

      expect(action.resolveGatewayMux).toHaveBeenCalledWith({
        agentShareId: 'share-1',
        gatewayUrl: GATEWAY_URL,
      });
      expect(action.createMuxClient).toHaveBeenCalledWith(mux, 'op-1', {
        executor: true,
        resumeOnConnect: true,
      });
      expect(action.createClient).not.toHaveBeenCalled();
      expect(muxClient.connect).toHaveBeenCalled();
      expect(v1Client.connect).not.toHaveBeenCalled();
      expect(state.gatewayConnections['op-1']).toEqual({ client: muxClient, status: 'connecting' });
    });

    it('keeps the v1 per-operation socket byte-for-byte when the flag is off', () => {
      mockLab.enableGatewayMux = false;
      const { action, state, v1Client } = createTestAction();

      action.connectToGateway({
        executor: true,
        gatewayUrl: GATEWAY_URL,
        operationId: 'op-1',
        token: 'tok',
        topicId: 'topic-1',
      });

      expect(action.createClient).toHaveBeenCalledWith({
        gatewayUrl: GATEWAY_URL,
        operationId: 'op-1',
        resumeOnConnect: undefined,
        token: 'tok',
      });
      expect(action.resolveGatewayMux).not.toHaveBeenCalled();
      expect(action.createMuxClient).not.toHaveBeenCalled();
      expect(v1Client.connect).toHaveBeenCalled();
      expect(state.gatewayConnections['op-1'].client).toBe(v1Client);
    });

    it('resolves the page-wide registry mux by default', () => {
      const { action } = createTestAction();
      action.resolveGatewayMux = getGatewayMux;

      action.connectToGateway({
        gatewayUrl: GATEWAY_URL,
        operationId: 'op-1',
        token: 'tok',
        topicId: 'topic-1',
      });

      expect(action.createMuxClient).toHaveBeenCalledWith(
        getGatewayMux({ gatewayUrl: GATEWAY_URL }),
        'op-1',
        expect.anything(),
      );
    });

    it('forwards a resume gap as a notify_update so the handler refetches from DB', () => {
      const onEvent = vi.fn();
      const { action, muxClient } = createTestAction();

      action.connectToGateway({
        gatewayUrl: GATEWAY_URL,
        onEvent,
        operationId: 'op-1',
        token: 'tok',
        topicId: 'topic-1',
      });

      muxClient.emit('resume_complete', { gap: false, status: 'running' });
      expect(onEvent).not.toHaveBeenCalled();

      muxClient.emit('resume_complete', { gap: true, status: 'running' });
      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'op-1', type: 'notify_update' }),
      );
    });

    it('records mux lifecycle notices in gatewayFeed, attaching once per mux', () => {
      const { action, mux, state } = createTestAction();

      action.connectToGateway({
        gatewayUrl: GATEWAY_URL,
        operationId: 'op-1',
        token: 'tok',
        topicId: 'topic-1',
      });
      action.connectToGateway({
        gatewayUrl: GATEWAY_URL,
        operationId: 'op-2',
        token: 'tok',
        topicId: 'topic-2',
      });

      const lifecycleAttachments = vi
        .mocked(mux.on)
        .mock.calls.filter(([event]) => event === 'lifecycle');
      expect(lifecycleAttachments).toHaveLength(1);

      mux.emit('lifecycle', {
        at: 1_700_000_000_000,
        meta: { agentId: 'agent-1', topicId: 'topic-9' },
        operationId: 'op-9',
        status: 'running',
        type: 'op_lifecycle',
      });
      mux.emit('lifecycle', {
        at: 1_700_000_000_500,
        operationId: 'op-9',
        status: 'gone',
        type: 'op_lifecycle',
      });

      expect(state.gatewayFeed).toEqual({
        'op-9': { at: 1_700_000_000_500, meta: undefined, status: 'gone' },
      });
    });

    it('survives without an auth_expired round trip (token is minted per dial)', () => {
      const { action, muxClient, state } = createTestAction();

      action.connectToGateway({
        gatewayUrl: GATEWAY_URL,
        operationId: 'op-1',
        token: 'tok',
        topicId: 'topic-1',
      });

      // The adapter never emits it; the handler is registered but inert.
      expect(vi.mocked(muxClient.on).mock.calls.some(([e]) => e === 'auth_expired')).toBe(true);
      expect(muxClient.updateToken).not.toHaveBeenCalled();
      expect(aiAgentService.refreshGatewayToken).not.toHaveBeenCalled();
      expect(state.gatewayConnections['op-1'].status).toBe('connecting');
    });
  });

  describe('warmupGatewayMux', () => {
    const withServerConfig = (serverConfig: Record<string, unknown>) => {
      (globalThis as any).window = {
        global_serverConfigStore: { getState: () => ({ serverConfig }) },
      };
    };

    it('dials the identity mux on app entry and attaches the feed once', () => {
      withServerConfig({ agentGatewayUrl: GATEWAY_URL, enableGatewayMode: true });
      const { action, mux, state } = createTestAction();

      action.warmupGatewayMux();
      action.warmupGatewayMux();

      expect(action.resolveGatewayMux).toHaveBeenCalledWith({ gatewayUrl: GATEWAY_URL });
      expect(mux.connect).toHaveBeenCalledTimes(2);
      mux.emit('lifecycle', {
        at: 1,
        operationId: 'op-feed',
        status: 'running',
        type: 'op_lifecycle',
      });
      expect(Object.keys(state.gatewayFeed)).toEqual(['op-feed']);
    });

    it('is a no-op when the lab flag is off or gateway mode is unavailable', () => {
      withServerConfig({ agentGatewayUrl: GATEWAY_URL, enableGatewayMode: true });
      mockLab.enableGatewayMux = false;
      const off = createTestAction();
      off.action.warmupGatewayMux();
      expect(off.mux.connect).not.toHaveBeenCalled();

      mockLab.enableGatewayMux = true;
      withServerConfig({ agentGatewayUrl: GATEWAY_URL, enableGatewayMode: false });
      const noGateway = createTestAction();
      noGateway.action.warmupGatewayMux();
      expect(noGateway.mux.connect).not.toHaveBeenCalled();
    });
  });

  describe('executor ownership', () => {
    const execResult = {
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
      topicId: 'topic-1',
      userMessageId: 'usr-1',
    };

    beforeEach(() => {
      (globalThis as any).window = {
        global_serverConfigStore: {
          getState: () => ({ serverConfig: { agentGatewayUrl: GATEWAY_URL } }),
        },
      };
    });

    it('executeGatewayAgent subscribes as executor (this tab started the run)', async () => {
      const connectToGateway = vi.fn();
      const { action } = createTestAction({
        associateMessageWithOperation: vi.fn(),
        connectToGateway,
        internal_dispatchTopic: vi.fn(),
        internal_replaceTopicId: vi.fn(),
        moveQueuedMessages: vi.fn(),
        moveVoiceMessages: vi.fn(),
        onOperationCancel: vi.fn(),
        refreshTopic: vi.fn().mockResolvedValue(undefined),
        replaceMessages: vi.fn(),
        startOperation: vi.fn(() => ({ operationId: 'gw-op-1' })),
        switchTopic: vi.fn(),
        topicDataMap: {},
        updateTopicStatus: vi.fn(),
      });
      vi.mocked(aiAgentService.execAgentTask).mockResolvedValue(execResult as any);

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', scope: 'main', threadId: null, topicId: 'topic-1' },
        message: 'Hello',
      });

      expect(connectToGateway).toHaveBeenCalledWith(
        expect.objectContaining({ executor: true, operationId: 'server-op-1' }),
      );
    });

    it('reconnectToGatewayOperation subscribes as a passive viewer', async () => {
      const connectToGateway = vi.fn();
      const { action } = createTestAction({
        activeAgentId: 'agent-1',
        associateMessageWithOperation: vi.fn(),
        connectToGateway,
        messagesMap: { 'agent-1_topic-1': [{ createdAt: Date.now(), id: 'ast-1' }] },
        onOperationCancel: vi.fn(),
        startOperation: vi.fn(() => ({ operationId: 'gw-op-reconnect' })),
        topicDataMap: {},
      });
      vi.mocked(aiAgentService.refreshGatewayToken).mockResolvedValue({
        token: 'fresh-token',
      } as any);

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      expect(connectToGateway).toHaveBeenCalledWith(
        expect.objectContaining({ executor: false, operationId: 'server-op-1' }),
      );
    });

    it('a resume gap on a real run handler refetches the topic messages from DB', async () => {
      // Capture the exact params executeGatewayAgent hands to connectToGateway
      // (real event router + handler), then open the connection for real.
      const captured = vi.fn();
      const replaceMessages = vi.fn();
      const { action, muxClient } = createTestAction({
        associateMessageWithOperation: vi.fn(),
        completeOperation: vi.fn(),
        connectToGateway: captured,
        internal_dispatchTopic: vi.fn(),
        internal_replaceTopicId: vi.fn(),
        moveQueuedMessages: vi.fn(),
        moveVoiceMessages: vi.fn(),
        onOperationCancel: vi.fn(),
        refreshTopic: vi.fn().mockResolvedValue(undefined),
        replaceMessages,
        startOperation: vi.fn(() => ({ operationId: 'gw-op-1' })),
        switchTopic: vi.fn(),
        topicDataMap: {},
        updateTopicStatus: vi.fn(),
      });
      vi.mocked(aiAgentService.execAgentTask).mockResolvedValue(execResult as any);

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', scope: 'main', threadId: null, topicId: 'topic-1' },
        message: 'Hello',
      });
      action.connectToGateway(captured.mock.calls[0][0]);
      vi.mocked(messageService.getMessages).mockClear();

      muxClient.emit('resume_complete', { gap: true, status: 'running' });
      await flushMicrotasks();

      expect(messageService.getMessages).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', topicId: 'topic-1' }),
      );
      expect(replaceMessages).toHaveBeenCalled();
    });
  });
});
