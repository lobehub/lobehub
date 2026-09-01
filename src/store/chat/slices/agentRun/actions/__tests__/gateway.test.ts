import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { RequestTrigger } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';
import { aiAgentService } from '@/services/aiAgent';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import type { GatewayConnection } from '../transports/gateway/gateway';
import { GatewayActionImpl } from '../transports/gateway/gateway';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execAgentTask: vi.fn(),
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
    sendInterrupt: vi.fn(),
    sendToolResult: vi.fn(() => true),
    updateToken: vi.fn(),
  };
}

// ─── Test Helpers ───

const TEST_TOPIC_ID = 'topic-test';

function createTestAction() {
  const state: Record<string, any> = { gatewayConnections: {} };
  const set = vi.fn((updater: any) => {
    if (typeof updater === 'function') {
      Object.assign(state, updater(state));
    } else {
      Object.assign(state, updater);
    }
  });
  const get = vi.fn(() => state as any);

  const action = new GatewayActionImpl(set as any, get, undefined);

  // Inject mock client factory
  const mockClient = createMockClient();
  action.createClient = vi.fn(() => mockClient);

  return { action, get, mockClient, set, state };
}

describe('GatewayActionImpl', () => {
  beforeEach(() => {
    moveChatContextSelections.mockClear();
    vi.mocked(topicService.settleRunningOperation).mockResolvedValue(undefined as never);
    mockAgentStore.state = { activeAgentId: undefined, agentMap: {} };
    mockUserDefaultConfig.disableGatewayMode = undefined;
    mockToolInterventionConfig.approvalMode = 'manual';
    mockToolInterventionConfig.allowList = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).window;
  });

  describe('isGatewayModeEnabled', () => {
    const setServerConfig = (serverConfig: Record<string, unknown>) => {
      (globalThis as any).window = {
        global_serverConfigStore: {
          getState: () => ({ serverConfig }),
        },
      };
    };

    it('returns true when backend enables Gateway mode and the agent does not disable it', () => {
      const { action } = createTestAction();
      setServerConfig({
        agentGatewayUrl: 'https://gateway.test.com',
        enableGatewayMode: true,
      });

      expect(action.isGatewayModeEnabled('agent-1')).toBe(true);
    });

    it('returns false when the current agent disables Gateway mode', () => {
      const { action } = createTestAction();
      setServerConfig({
        agentGatewayUrl: 'https://gateway.test.com',
        enableGatewayMode: true,
      });
      mockAgentStore.state = {
        activeAgentId: 'agent-1',
        agentMap: { 'agent-1': { chatConfig: { disableGatewayMode: true } } },
      };

      expect(action.isGatewayModeEnabled('agent-1')).toBe(false);
    });

    it('falls back to the app-level default agent config', () => {
      const { action } = createTestAction();
      setServerConfig({
        agentGatewayUrl: 'https://gateway.test.com',
        enableGatewayMode: true,
      });
      mockUserDefaultConfig.disableGatewayMode = true;

      expect(action.isGatewayModeEnabled('agent-1')).toBe(false);
    });

    it('returns false when the backend does not enable Gateway mode', () => {
      const { action } = createTestAction();
      setServerConfig({
        agentGatewayUrl: 'https://gateway.test.com',
        enableGatewayMode: false,
      });

      expect(action.isGatewayModeEnabled('agent-1')).toBe(false);
    });
  });

  describe('connectToGateway', () => {
    it('should create client and add to store', () => {
      const { action, mockClient, state } = createTestAction();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      expect(state.gatewayConnections['op-1']).toBeDefined();
      expect(state.gatewayConnections['op-1'].status).toBe('connecting');
      expect(mockClient.connect).toHaveBeenCalledOnce();
    });

    it('should wire up status_changed listener', () => {
      const { action, mockClient, state } = createTestAction();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      mockClient.emitEvent('status_changed', 'connected');
      expect(state.gatewayConnections['op-1'].status).toBe('connected');
    });

    it('should forward agent events to onEvent callback', () => {
      const { action, mockClient } = createTestAction();
      const events: AgentStreamEvent[] = [];

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        onEvent: (e) => events.push(e),
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      const testEvent: AgentStreamEvent = {
        data: { content: 'hello' },
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'stream_chunk',
      };
      mockClient.emitEvent('agent_event', testEvent);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(testEvent);
    });

    it('should cleanup on session_complete', () => {
      const { action, mockClient, state } = createTestAction();
      const onComplete = vi.fn();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        onSessionComplete: onComplete,
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      mockClient.emitEvent('session_complete', { source: 'raw_session_complete' });
      expect(state.gatewayConnections['op-1']).toBeUndefined();
      expect(onComplete).toHaveBeenCalledOnce();
      expect(onComplete).toHaveBeenCalledWith({
        authFailed: false,
        completion: { source: 'raw_session_complete' },
        succeeded: false,
        terminalReceived: false,
      });
    });

    it('should cleanup on disconnected', () => {
      const { action, mockClient, state } = createTestAction();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      mockClient.emitEvent('disconnected');
      expect(state.gatewayConnections['op-1']).toBeUndefined();
    });

    it('should cleanup on auth_failed', () => {
      const { action, mockClient, state } = createTestAction();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      mockClient.emitEvent('auth_failed', 'invalid token');
      expect(state.gatewayConnections['op-1']).toBeUndefined();
    });

    // Regression: when the server rejects auth (e.g. the op was GC'd or the
    // refreshed JWT no longer matches), the local op stayed `running` forever
    // because `auth_failed` only cleaned the connection map and never fired
    // `onSessionComplete`. The `disconnected` listener that follows can't fix
    // this either — `receivedTerminalEvent` is false (no agent_event arrived),
    // so it short-circuits. Net result: input shows the stop button forever
    // and `topic.metadata.runningOperation` stays set, so every revisit
    // re-fires the same broken reconnect.
    it('should fire onSessionComplete on auth_failed so the local op gets completed', () => {
      const { action, mockClient } = createTestAction();
      const onSessionComplete = vi.fn();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        onSessionComplete,
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      mockClient.emitEvent('auth_failed', 'invalid token');
      expect(onSessionComplete).toHaveBeenCalledOnce();
    });

    // Same regression, but for the WS-close that follows `auth_failed`.
    // The previous behavior fired `disconnected` after `auth_failed`, but
    // since `receivedTerminalEvent` is false, the disconnected listener also
    // skipped onSessionComplete. The fix should still only call it once
    // (through the auth_failed path) — not twice.
    it('should not fire onSessionComplete twice when auth_failed is followed by disconnected', () => {
      const { action, mockClient } = createTestAction();
      const onSessionComplete = vi.fn();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        onSessionComplete,
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      mockClient.emitEvent('auth_failed', 'invalid token');
      mockClient.emitEvent('disconnected');
      expect(onSessionComplete).toHaveBeenCalledOnce();
    });

    describe('auth_expired (recoverable)', () => {
      it('should refresh token, reconnect, and NOT fire onSessionComplete', async () => {
        const { action, mockClient } = createTestAction();
        const onSessionComplete = vi.fn();
        vi.mocked(aiAgentService.refreshGatewayToken).mockResolvedValueOnce({
          token: 'fresh-token',
        });

        action.connectToGateway({
          gatewayUrl: 'https://gateway.test.com',
          onSessionComplete,
          operationId: 'op-1',
          token: 'old-token',
          topicId: TEST_TOPIC_ID,
        });

        mockClient.emitEvent('auth_expired');
        // The handler is async — let the promise chain settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(aiAgentService.refreshGatewayToken).toHaveBeenCalledWith(TEST_TOPIC_ID);
        expect(mockClient.updateToken).toHaveBeenCalledWith('fresh-token');
        expect(mockClient.reconnect).toHaveBeenCalledOnce();
        // Critical: this is recoverable, so the local op MUST keep running.
        expect(onSessionComplete).not.toHaveBeenCalled();
      });

      it('should fire onSessionComplete when token refresh itself throws', async () => {
        const { action, mockClient } = createTestAction();
        const onSessionComplete = vi.fn();
        vi.mocked(aiAgentService.refreshGatewayToken).mockRejectedValueOnce(
          new Error('refresh API down'),
        );

        action.connectToGateway({
          gatewayUrl: 'https://gateway.test.com',
          onSessionComplete,
          operationId: 'op-1',
          token: 'old-token',
          topicId: TEST_TOPIC_ID,
        });

        mockClient.emitEvent('auth_expired');
        await Promise.resolve();
        await Promise.resolve();

        expect(aiAgentService.refreshGatewayToken).toHaveBeenCalledWith(TEST_TOPIC_ID);
        // No reconnect attempted — refresh failed, give up cleanly.
        expect(mockClient.reconnect).not.toHaveBeenCalled();
        expect(mockClient.disconnect).toHaveBeenCalled();
        expect(onSessionComplete).toHaveBeenCalledOnce();
      });
    });

    it('should disconnect existing connection before creating new one', () => {
      const { action, state } = createTestAction();

      // First connection with its own mock
      const firstMock = createMockClient();
      action.createClient = vi.fn(() => firstMock);
      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'token-1',
        topicId: TEST_TOPIC_ID,
      });

      // Second connection
      const secondMock = createMockClient();
      action.createClient = vi.fn(() => secondMock);
      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'token-2',
        topicId: TEST_TOPIC_ID,
      });

      expect(firstMock.disconnect).toHaveBeenCalled();
      expect(state.gatewayConnections['op-1'].client).toBe(secondMock);
    });
  });

  describe('disconnectFromGateway', () => {
    it('should disconnect and cleanup', () => {
      const { action, mockClient, state } = createTestAction();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      action.disconnectFromGateway('op-1');
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(state.gatewayConnections['op-1']).toBeUndefined();
    });

    it('should be a no-op for unknown operationId', () => {
      const { action } = createTestAction();
      action.disconnectFromGateway('nonexistent');
    });
  });

  describe('interruptGatewayAgent', () => {
    it('should send interrupt to the client', () => {
      const { action, mockClient } = createTestAction();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      action.interruptGatewayAgent('op-1');
      expect(mockClient.sendInterrupt).toHaveBeenCalledOnce();
    });

    it('should be a no-op for unknown operationId', () => {
      const { action } = createTestAction();
      action.interruptGatewayAgent('nonexistent');
    });
  });

  describe('getGatewayConnectionStatus', () => {
    it('should return status for active connection', () => {
      const { action } = createTestAction();

      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'test-token',
        topicId: TEST_TOPIC_ID,
      });

      expect(action.getGatewayConnectionStatus('op-1')).toBe('connecting');
    });

    it('should return undefined for unknown operationId', () => {
      const { action } = createTestAction();
      expect(action.getGatewayConnectionStatus('nonexistent')).toBeUndefined();
    });
  });

  describe('executeGatewayAgent', () => {
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

    it('should forward parentMessageId to execAgentTask for regeneration', async () => {
      const { action } = createExecuteTestAction();

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
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: 'topic-1', threadId: null, scope: 'main' },
        message: 'Original question',
        parentMessageId: 'user-msg-123',
      });

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          parentMessageId: 'user-msg-123',
          prompt: 'Original question',
        }),
        expect.anything(),
      );
    });

    it('should not include parentMessageId when not provided (normal send)', async () => {
      const { action } = createExecuteTestAction();

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
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: 'topic-1', threadId: null, scope: 'main' },
        message: 'Hello',
      });

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          parentMessageId: undefined,
          prompt: 'Hello',
        }),
        expect.anything(),
      );
    });

    it('should execute as the target agent while routing messages to the parent conversation', async () => {
      const { action, moveQueuedMessages, startOperation, updateTopicStatus } =
        createExecuteTestAction();
      const executionContext = {
        agentId: 'target-agent',
        scope: 'sub_agent' as const,
        subAgentId: 'target-agent',
        topicId: 'topic-1',
      };
      const messageContext = {
        agentId: 'parent-agent',
        scope: 'main' as const,
        topicId: 'topic-1',
      };

      vi.mocked(aiAgentService.execAgentTask).mockResolvedValue({
        agentId: 'target-agent',
        assistantMessageId: 'ast-target',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'ok',
        operationId: 'server-op-target',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        token: 'test-token',
        topicId: 'topic-1',
        userMessageId: 'usr-target',
      });

      await action.executeGatewayAgent({
        context: executionContext,
        message: 'Delegated work',
        messageContext,
      });

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'target-agent',
          appContext: expect.objectContaining({ scope: 'sub_agent', topicId: 'topic-1' }),
        }),
        expect.anything(),
      );
      expect(startOperation).toHaveBeenCalledWith(
        expect.objectContaining({ context: messageContext }),
      );
      expect(moveQueuedMessages).toHaveBeenCalledWith(
        messageMapKey(messageContext),
        messageMapKey(messageContext),
      );
      expect(updateTopicStatus).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'parent-agent', topicId: 'topic-1' }),
      );
    });

    it('should move queued follow-ups from the new-topic key to the server-created topic key', async () => {
      const { action, moveQueuedMessages, moveVoiceMessages } = createExecuteTestAction();
      const context = { agentId: 'agent-1', topicId: null, threadId: null };

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
        context,
        message: 'Hello',
      });

      expect(moveQueuedMessages).toHaveBeenCalledWith(
        messageMapKey(context),
        messageMapKey({ ...context, topicId: 'topic-created' }),
      );
      expect(moveVoiceMessages).toHaveBeenCalledWith(context, {
        ...context,
        topicId: 'topic-created',
      });
    });

    it('should replace the optimistic topic placeholder with the server topic id', async () => {
      const { action, internalReplaceTopicId } = createExecuteTestAction();

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
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: null, threadId: null, scope: 'main' },
        message: '666',
        optimisticTopic: { id: 'tmp-topic', title: '666' },
      });

      expect(internalReplaceTopicId).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        nextId: 'topic-1',
        previousId: 'tmp-topic',
        value: {
          sessionId: 'agent-1',
          title: '666',
        },
      });
      expect(moveChatContextSelections).toHaveBeenCalledWith(
        messageMapKey({
          agentId: 'agent-1',
          scope: 'main',
          threadId: null,
          topicId: 'tmp-topic',
        }),
        messageMapKey({
          agentId: 'agent-1',
          scope: 'main',
          threadId: null,
          topicId: 'topic-1',
        }),
      );
    });

    it('should keep optimistic topic metadata when replacing the placeholder topic id', async () => {
      const { action, internalReplaceTopicId } = createExecuteTestAction();
      const selectedRepo = 'https://github.com/lobehub/lobehub';

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
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: null, threadId: null, scope: 'main' },
        message: 'Create a project topic',
        optimisticTopic: {
          id: 'tmp-topic',
          metadata: {
            repos: [selectedRepo],
            workingDirectory: selectedRepo,
            workingDirectoryConfig: { path: selectedRepo, repoType: 'github' },
          },
          title: 'Create a project topic',
        },
      });

      expect(internalReplaceTopicId).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        nextId: 'topic-1',
        previousId: 'tmp-topic',
        value: {
          metadata: {
            repos: [selectedRepo],
            workingDirectory: selectedRepo,
            workingDirectoryConfig: { path: selectedRepo, repoType: 'github' },
          },
          sessionId: 'agent-1',
          title: 'Create a project topic',
        },
      });
    });

    it('should forward metadata trigger to execAgentTask', async () => {
      const { action } = createExecuteTestAction();

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
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: 'topic-1', threadId: null, scope: 'main' },
        message: 'Hello',
        metadata: { trigger: RequestTrigger.Onboarding },
      });

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Hello',
          trigger: 'onboarding',
        }),
        expect.anything(),
      );
    });

    it('should forward current user intervention config to execAgentTask', async () => {
      const { action } = createExecuteTestAction();
      mockToolInterventionConfig.approvalMode = 'allow-list';
      mockToolInterventionConfig.allowList = ['lobe-user-interaction/askUserQuestion'];

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
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: 'topic-1', threadId: null, scope: 'main' },
        message: 'Hello',
      });

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Hello',
          userInterventionConfig: {
            allowList: ['lobe-user-interaction/askUserQuestion'],
            approvalMode: 'allow-list',
          },
        }),
        expect.anything(),
      );
    });

    it('should forward task manager default assignee and current task context', async () => {
      const { action } = createExecuteTestAction();

      vi.mocked(aiAgentService.execAgentTask).mockResolvedValue({
        agentId: 'agent-task',
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
      });

      await action.executeGatewayAgent({
        context: {
          agentId: 'agent-task',
          defaultTaskAssigneeAgentId: 'agt_inbox',
          scope: 'task',
          topicId: 'topic-1',
          viewedTask: { taskId: 'T-1', type: 'detail' },
        },
        message: 'Assign this task',
      });

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          appContext: expect.objectContaining({
            defaultTaskAssigneeAgentId: 'agt_inbox',
            scope: 'task',
            taskId: 'T-1',
          }),
        }),
        expect.anything(),
      );
    });

    it('should forward empty prompt for continue generation', async () => {
      const { action } = createExecuteTestAction();

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
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: 'topic-1', threadId: null, scope: 'main' },
        message: '',
        parentMessageId: 'assistant-msg-456',
      });

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          parentMessageId: 'assistant-msg-456',
          prompt: '',
        }),
        expect.anything(),
      );
    });

    it('reconciles an accepted message but skips the gateway child when cancel races with phase-1 persistence', async () => {
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-local' }));
      const completeOperation = vi.fn();
      const associateMessageWithOperation = vi.fn();
      const connectToGateway = vi.fn();
      const moveQueuedMessages = vi.fn();
      const onOperationCancel = vi.fn();
      const onMessageAccepted = vi.fn();
      const replaceMessages = vi.fn();

      const controller = new AbortController();

      const mockClient = createMockClient();
      const state: Record<string, any> = { gatewayConnections: {} };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation,
        completeOperation,
        connectToGateway,
        getOperationAbortSignal: vi.fn(() => controller.signal),
        moveQueuedMessages,
        moveVoiceMessages: vi.fn(),
        onOperationCancel,
        replaceMessages,
        startOperation,
        switchTopic: vi.fn(),
      })) as any;

      (globalThis as any).window = {
        global_serverConfigStore: {
          getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
        },
      };

      const action = new GatewayActionImpl(set as any, get, undefined);
      action.createClient = vi.fn(() => mockClient);
      const interruptTaskSpy = vi
        .mocked(aiAgentService.interruptTask)
        .mockResolvedValue({ operationId: 'server-op-cancel', success: true });
      const persistedResult = {
        agentId: 'agent-1',
        assistantMessageId: 'ast-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'ok',
        operationId: 'server-op-cancel',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        token: 'test-token',
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      } as const;
      let resolvePersistence!: (value: typeof persistedResult) => void;
      vi.mocked(aiAgentService.execAgentTask).mockReturnValue(
        new Promise((resolve) => {
          resolvePersistence = resolve;
        }),
      );
      vi.mocked(messageService.getMessages).mockRejectedValueOnce(new Error('refresh failed'));

      const execution = action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: 'topic-1', threadId: null, scope: 'main' },
        message: 'Hello',
        onMessageAccepted,
        parentOperationId: 'parent-send-msg-op',
      });
      await vi.waitFor(() => expect(aiAgentService.execAgentTask).toHaveBeenCalledOnce());
      controller.abort('user cancelled');
      resolvePersistence(persistedResult);

      await expect(execution).resolves.toEqual(persistedResult);

      expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ signal: controller.signal }),
      );
      // Server task was created before the signal flipped — best-effort
      // interrupt must fire so the agent run stops server-side.
      await vi.waitFor(() =>
        expect(interruptTaskSpy).toHaveBeenCalledWith({
          operationId: 'server-op-cancel',
          topicId: 'topic-1',
        }),
      );
      expect(onMessageAccepted).toHaveBeenCalledOnce();
      expect(replaceMessages).not.toHaveBeenCalled();
      expect(moveQueuedMessages).toHaveBeenCalledOnce();
      expect(startOperation).not.toHaveBeenCalled();
      expect(associateMessageWithOperation).not.toHaveBeenCalled();
      expect(connectToGateway).not.toHaveBeenCalled();
      expect(completeOperation).toHaveBeenCalledWith('parent-send-msg-op');
    });

    /**
     * @example Send now receives the server's physical device cancellation result.
     */
    it('registers a cancel handler that propagates unconfirmed device shutdown', async () => {
      // ROOT CAUSE:
      //
      // The gateway hook awaited interruptTask but discarded its result. A local
      // Codex process could report `deviceCancellationConfirmed: false` while the
      // hook resolved, allowing QueueTray to remove the message and send again.
      //
      // Before: interruptTask(...).catch(log) always resolved the cancel hook.
      // After: an explicit false confirmation rejects the cancel hook.
      const onOperationCancel = vi.fn();
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-local' }));

      const mockClient = createMockClient();
      const state: Record<string, any> = { gatewayConnections: {}, topicDataMap: {} };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        connectToGateway: vi.fn(),
        internal_dispatchTopic: vi.fn(),
        moveQueuedMessages: vi.fn(),
        moveVoiceMessages: vi.fn(),
        onOperationCancel,
        replaceMessages: vi.fn(),
        startOperation,
        switchTopic: vi.fn(),
      })) as any;

      (globalThis as any).window = {
        global_serverConfigStore: {
          getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
        },
      };

      const action = new GatewayActionImpl(set as any, get, undefined);
      action.createClient = vi.fn(() => mockClient);
      const interruptTaskSpy = vi
        .mocked(aiAgentService.interruptTask)
        .mockResolvedValue({ operationId: 'server-op-xyz', success: true });

      vi.mocked(aiAgentService.execAgentTask).mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'ast-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'ok',
        operationId: 'server-op-xyz',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        token: 'test-token',
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: 'topic-1', threadId: null, scope: 'main' },
        message: 'Hello',
      });

      // Handler was registered against the local operation id...
      expect(onOperationCancel).toHaveBeenCalledWith('gw-op-local', expect.any(Function));

      // ...and, when invoked, fires tRPC interruptTask with the *server-side* operation id
      const [, handler] = onOperationCancel.mock.calls[0];
      await handler();
      expect(interruptTaskSpy).toHaveBeenCalledWith({
        operationId: 'server-op-xyz',
        topicId: 'topic-1',
      });

      interruptTaskSpy.mockResolvedValueOnce({
        deviceCancellationConfirmed: false,
        operationId: 'server-op-xyz',
        success: true,
      });
      await expect(handler()).rejects.toThrow(
        'Gateway operation server-op-xyz cancellation unconfirmed',
      );
    });

    // Regression: after an error run the gateway session completes
    // and clears the SERVER-side topic metadata, but the local Zustand store copy
    // of `runningOperation` stayed set — so useGatewayReconnect kept firing a
    // reconnect for a dead op and looped 404s. onSessionComplete must ALSO clear
    // the local store marker (spreading the rest of metadata).
    it('clears the local runningOperation marker when the gateway session completes with an error', async () => {
      const connectToGateway = vi.fn();
      const internalDispatchTopic = vi.fn();
      const internalPinTopicStatus = vi.fn();
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-1' }));
      const state: Record<string, any> = {
        activeAgentId: 'agent-1',
        activeTopicId: 'topic-1',
        gatewayConnections: {},
        topicDataMap: {
          'agent_agent-1': {
            items: [
              {
                id: 'topic-1',
                metadata: {
                  model: 'gpt-4',
                  runningOperation: { assistantMessageId: 'ast-1', operationId: 'server-op-1' },
                },
              },
            ],
          },
        },
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        completeOperation: vi.fn(),
        connectToGateway,
        internal_dispatchTopic: internalDispatchTopic,
        internal_pinTopicStatus: internalPinTopicStatus,
        moveQueuedMessages: vi.fn(),
        moveVoiceMessages: vi.fn(),
        onOperationCancel: vi.fn(),
        startOperation,
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
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', scope: 'main', threadId: null, topicId: 'topic-1' },
        message: 'Hello',
      });

      const { onSessionComplete } = connectToGateway.mock.calls[0][0];
      // Ignore any dispatches from the optimistic-update path during setup.
      internalDispatchTopic.mockClear();
      internalPinTopicStatus.mockClear();
      vi.mocked(topicService.updateTopicMetadata).mockResolvedValue(undefined as never);

      onSessionComplete({ succeeded: false, terminalReceived: true });

      expect(internalDispatchTopic).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        id: 'topic-1',
        type: 'updateTopic',
        value: { metadata: { model: 'gpt-4', runningOperation: null } },
      });
      expect(internalPinTopicStatus).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        status: 'active',
        topicId: 'topic-1',
      });
    });

    // Background completion: the run's owning agent bucket must be targeted even
    // after the user switched to another agent — the active-bucket lookup would
    // miss the topic and leave its runningOperation marker stale.
    it('clears the owning bucket marker even after the user switched agents', async () => {
      const connectToGateway = vi.fn();
      const internalDispatchTopic = vi.fn();
      const internalPinTopicStatus = vi.fn();
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-1' }));
      const state: Record<string, any> = {
        activeAgentId: 'agent-1',
        activeTopicId: 'topic-1',
        gatewayConnections: {},
        topicDataMap: {
          'agent_agent-1': {
            items: [
              {
                id: 'topic-1',
                metadata: {
                  model: 'gpt-4',
                  runningOperation: { assistantMessageId: 'ast-1', operationId: 'server-op-1' },
                },
              },
            ],
          },
          'agent_agent-2': { items: [] },
        },
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        completeOperation: vi.fn(),
        connectToGateway,
        internal_dispatchTopic: internalDispatchTopic,
        internal_pinTopicStatus: internalPinTopicStatus,
        moveQueuedMessages: vi.fn(),
        moveVoiceMessages: vi.fn(),
        onOperationCancel: vi.fn(),
        startOperation,
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
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', scope: 'main', threadId: null, topicId: 'topic-1' },
        message: 'Hello',
      });

      const { onSessionComplete } = connectToGateway.mock.calls[0][0];
      internalDispatchTopic.mockClear();
      internalPinTopicStatus.mockClear();
      vi.mocked(topicService.updateTopicMetadata).mockResolvedValue(undefined as never);

      // The user switched away before the run finished in the background.
      state.activeAgentId = 'agent-2';
      state.activeTopicId = null;

      onSessionComplete({ succeeded: false, terminalReceived: true });

      expect(internalDispatchTopic).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        id: 'topic-1',
        type: 'updateTopic',
        value: { metadata: { model: 'gpt-4', runningOperation: null } },
      });
      expect(internalPinTopicStatus).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        status: 'active',
        topicId: 'topic-1',
      });
    });

    // A late close may observe a stale local marker even after another tab has
    // started a newer operation. Send the completing operation id to the server
    // so its row-locked compare-and-set can reject the stale clear.
    it('settles by operation id without retiring a newer local operation', async () => {
      const connectToGateway = vi.fn();
      const internalDispatchTopic = vi.fn();
      const updateTopicStatus = vi.fn();
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-1' }));
      const state: Record<string, any> = {
        activeAgentId: 'agent-1',
        activeTopicId: 'topic-1',
        gatewayConnections: {},
        topicDataMap: {
          'agent_agent-1': {
            items: [
              {
                id: 'topic-1',
                metadata: {
                  model: 'gpt-4',
                  // Marker already points at a newer op than the one completing below.
                  runningOperation: { assistantMessageId: 'ast-2', operationId: 'server-op-NEWER' },
                },
              },
            ],
          },
        },
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        completeOperation: vi.fn(),
        connectToGateway,
        internal_dispatchTopic: internalDispatchTopic,
        moveQueuedMessages: vi.fn(),
        moveVoiceMessages: vi.fn(),
        onOperationCancel: vi.fn(),
        startOperation,
        updateTopicStatus,
      })) as any;

      (globalThis as any).window = {
        global_serverConfigStore: {
          getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
        },
      };

      const action = new GatewayActionImpl(set as any, get, undefined);
      action.createClient = vi.fn(() => createMockClient());

      vi.mocked(aiAgentService.execAgentTask).mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'ast-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        heteroType: null,
        message: 'ok',
        operationId: 'server-op-1',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        token: 'test-token',
        topicId: 'topic-1',
        userMessageId: 'usr-1',
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', scope: 'main', threadId: null, topicId: 'topic-1' },
        message: 'Hello',
      });

      expect(internalDispatchTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.objectContaining({
            metadata: expect.objectContaining({
              runningOperation: {
                assistantMessageId: 'ast-1',
                heteroType: null,
                operationId: 'server-op-1',
              },
            }),
          }),
        }),
      );

      const { onSessionComplete } = connectToGateway.mock.calls[0][0];
      // Ignore any dispatches / writes from the optimistic-update path during setup.
      internalDispatchTopic.mockClear();
      updateTopicStatus.mockClear();
      vi.mocked(topicService.settleRunningOperation).mockClear();
      vi.mocked(topicService.settleRunningOperation).mockResolvedValue(undefined as never);

      onSessionComplete({ succeeded: false, terminalReceived: true });

      expect(internalDispatchTopic).not.toHaveBeenCalled();
      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'active',
      );
      expect(updateTopicStatus).not.toHaveBeenCalled();
    });

    it('preserves only external-producer resume status without a terminal event', async () => {
      const runCompletion = async ({
        activeTopicId = 'topic-1',
        authFailed = false,
        completion,
        heteroType,
      }: {
        activeTopicId?: string | null;
        authFailed?: boolean;
        completion:
          { source: 'raw_session_complete' } | { source: 'resume_status'; status: 'completed' };
        heteroType: string | null | undefined;
      }) => {
        const connectToGateway = vi.fn();
        const completeOperation = vi.fn();
        const internalDispatchTopic = vi.fn();
        const startOperation = vi.fn(() => ({ operationId: 'gw-op-1' }));
        const state: Record<string, any> = {
          activeAgentId: 'agent-1',
          activeTopicId,
          gatewayConnections: {},
          topicDataMap: {
            'agent_agent-1': {
              items: [
                {
                  id: 'topic-1',
                  metadata: {
                    runningOperation: { assistantMessageId: 'ast-1', operationId: 'server-op-1' },
                  },
                  status: 'running',
                },
              ],
            },
          },
        };
        const set = vi.fn((updater: any) => {
          if (typeof updater === 'function') Object.assign(state, updater(state));
          else Object.assign(state, updater);
        });
        const get = vi.fn(() => ({
          ...state,
          associateMessageWithOperation: vi.fn(),
          completeOperation,
          connectToGateway,
          internal_dispatchTopic: internalDispatchTopic,
          moveQueuedMessages: vi.fn(),
          moveVoiceMessages: vi.fn(),
          onOperationCancel: vi.fn(),
          startOperation,
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
          agentId: 'agent-1',
          assistantMessageId: 'ast-1',
          autoStarted: true,
          createdAt: new Date().toISOString(),
          heteroType,
          message: 'ok',
          operationId: 'server-op-1',
          status: 'created',
          success: true,
          timestamp: new Date().toISOString(),
          token: 'test-token',
          topicId: 'topic-1',
          userMessageId: 'usr-1',
        });

        await action.executeGatewayAgent({
          context: { agentId: 'agent-1', scope: 'main', threadId: null, topicId: 'topic-1' },
          message: 'Hello',
        });

        const { onSessionComplete } = connectToGateway.mock.calls[0][0];
        completeOperation.mockClear();
        internalDispatchTopic.mockClear();
        vi.mocked(topicService.settleRunningOperation).mockClear();

        onSessionComplete({ authFailed, completion, succeeded: false, terminalReceived: false });

        return { completeOperation, internalDispatchTopic };
      };

      const heteroResume = await runCompletion({
        completion: { source: 'resume_status', status: 'completed' },
        heteroType: 'claude-code',
      });
      expect(heteroResume.completeOperation).toHaveBeenCalledWith('gw-op-1');
      expect(topicService.settleRunningOperation).not.toHaveBeenCalled();
      expect(heteroResume.internalDispatchTopic).not.toHaveBeenCalled();

      const rollingUnknown = await runCompletion({
        completion: { source: 'resume_status', status: 'completed' },
        heteroType: undefined,
      });
      expect(topicService.settleRunningOperation).not.toHaveBeenCalled();
      expect(rollingUnknown.internalDispatchTopic).not.toHaveBeenCalled();

      const normalResume = await runCompletion({
        completion: { source: 'resume_status', status: 'completed' },
        heteroType: null,
      });
      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'active',
      );
      expect(normalResume.internalDispatchTopic).toHaveBeenCalled();

      await runCompletion({
        activeTopicId: 'some-other-topic',
        completion: { source: 'resume_status', status: 'completed' },
        heteroType: null,
      });
      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'unread',
      );

      await runCompletion({
        completion: { source: 'raw_session_complete' },
        heteroType: 'claude-code',
      });
      expect(topicService.settleRunningOperation).toHaveBeenCalled();

      await runCompletion({
        authFailed: true,
        completion: { source: 'resume_status', status: 'completed' },
        heteroType: 'claude-code',
      });
      expect(topicService.settleRunningOperation).toHaveBeenCalled();
    });

    // Regression guard: a successful run the user is watching must reset the
    // topic's local `status` back to 'active', not just clear the metadata
    // marker. `settleRunningOperation` above writes this to the DB, but it
    // does not touch the Zustand topic map — without this local mirror, the
    // sidebar spinner (gated on `topic.status === 'running'` once the local
    // operation itself completes) is stuck permanently, even though the
    // conversation is genuinely finished.
    it('resets the local topic status to active when a watched run completes successfully', async () => {
      const connectToGateway = vi.fn();
      const internalDispatchTopic = vi.fn();
      const internalPinTopicStatus = vi.fn();
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-1' }));
      const state: Record<string, any> = {
        activeAgentId: 'agent-1',
        activeTopicId: 'topic-1',
        gatewayConnections: {},
        topicDataMap: {
          'agent_agent-1': {
            items: [
              {
                id: 'topic-1',
                metadata: {
                  model: 'gpt-4',
                  runningOperation: { assistantMessageId: 'ast-1', operationId: 'server-op-1' },
                },
                status: 'running',
              },
            ],
          },
        },
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        completeOperation: vi.fn(),
        connectToGateway,
        internal_dispatchTopic: internalDispatchTopic,
        internal_pinTopicStatus: internalPinTopicStatus,
        moveQueuedMessages: vi.fn(),
        moveVoiceMessages: vi.fn(),
        onOperationCancel: vi.fn(),
        startOperation,
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
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', scope: 'main', threadId: null, topicId: 'topic-1' },
        message: 'Hello',
      });

      const { onSessionComplete } = connectToGateway.mock.calls[0][0];
      internalDispatchTopic.mockClear();
      internalPinTopicStatus.mockClear();
      vi.mocked(topicService.settleRunningOperation).mockClear();
      vi.mocked(topicService.settleRunningOperation).mockResolvedValue(undefined as never);

      // Still viewing the topic when the run's terminal event lands.
      onSessionComplete({ succeeded: true, terminalReceived: true });

      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'active',
      );
      expect(internalDispatchTopic).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        id: 'topic-1',
        type: 'updateTopic',
        value: { metadata: { model: 'gpt-4', runningOperation: null } },
      });
      // Routed through the pin-aware setter, not a bare dispatch — see
      // `internal_pinTopicStatus`'s doc comment for why that matters.
      expect(internalPinTopicStatus).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        status: 'active',
        topicId: 'topic-1',
      });
    });

    // The clean, unwatched-completion case is owned by `markTopicUnread`
    // elsewhere — the local mirror here must NOT also write 'active' for it,
    // or the two would race over the status field.
    it('does not touch the local topic status for a clean completion the user is not watching', async () => {
      const connectToGateway = vi.fn();
      const internalDispatchTopic = vi.fn();
      const internalPinTopicStatus = vi.fn();
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-1' }));
      const state: Record<string, any> = {
        activeAgentId: 'agent-1',
        activeTopicId: null,
        gatewayConnections: {},
        topicDataMap: {
          'agent_agent-1': {
            items: [
              {
                id: 'topic-1',
                metadata: {
                  model: 'gpt-4',
                  runningOperation: { assistantMessageId: 'ast-1', operationId: 'server-op-1' },
                },
                status: 'running',
              },
            ],
          },
        },
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        completeOperation: vi.fn(),
        connectToGateway,
        internal_dispatchTopic: internalDispatchTopic,
        internal_pinTopicStatus: internalPinTopicStatus,
        moveQueuedMessages: vi.fn(),
        moveVoiceMessages: vi.fn(),
        onOperationCancel: vi.fn(),
        startOperation,
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
      });

      await action.executeGatewayAgent({
        context: { agentId: 'agent-1', scope: 'main', threadId: null, topicId: 'topic-1' },
        message: 'Hello',
      });

      const { onSessionComplete } = connectToGateway.mock.calls[0][0];
      internalDispatchTopic.mockClear();
      internalPinTopicStatus.mockClear();
      vi.mocked(topicService.settleRunningOperation).mockClear();
      vi.mocked(topicService.settleRunningOperation).mockResolvedValue(undefined as never);

      // Not viewing, and the run succeeded cleanly in the background.
      onSessionComplete({ succeeded: true, terminalReceived: true });

      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'unread',
      );
      expect(internalDispatchTopic).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        id: 'topic-1',
        type: 'updateTopic',
        value: { metadata: { model: 'gpt-4', runningOperation: null } },
      });
      expect(internalPinTopicStatus).not.toHaveBeenCalled();
    });

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
          expect.anything(),
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
          expect.anything(),
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
          expect.anything(),
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
    });
  });

  describe('reconnectToGatewayOperation', () => {
    function createReconnectTestAction(assistantMessage: any) {
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-reconnect' }));
      const mockClient = createMockClient();
      const state: Record<string, any> = {
        activeAgentId: 'agent-1',
        gatewayConnections: {},
        messagesMap: { 'agent-1_topic-1': assistantMessage ? [assistantMessage] : [] },
        // getTopicById reads here; an empty map yields no running op so the
        // reconnect guards fall through to startOperation.
        topicDataMap: {},
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        connectToGateway: vi.fn(),
        onOperationCancel: vi.fn(),
        startOperation,
      })) as any;

      (globalThis as any).window = {
        global_serverConfigStore: {
          getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
        },
      };

      vi.mocked(aiAgentService.refreshGatewayToken).mockResolvedValue({
        token: 'fresh-token',
      } as any);

      const action = new GatewayActionImpl(set as any, get, undefined);
      action.createClient = vi.fn(() => mockClient);

      return { action, startOperation };
    }

    afterEach(() => {
      delete (globalThis as any).window;
    });

    // After a DB rehydrate (e.g. quit + relaunch), `createdAt` can arrive as an
    // ISO string instead of epoch ms. Anchoring startTime to it raw makes
    // `Date.now() - startTime` evaluate to NaN, which the elapsed-time label
    // renders as "NaN:NaN". The reconnect path must normalize it to a number.
    it('normalizes an ISO-string createdAt into an epoch-ms startTime', async () => {
      const createdAtMs = 1_700_000_000_000;
      const { action, startOperation } = createReconnectTestAction({
        createdAt: new Date(createdAtMs).toISOString(),
        id: 'ast-1',
      });

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      expect(startOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ startTime: createdAtMs }),
        }),
      );
    });

    it('omits startTime when createdAt is not a parseable date', async () => {
      const { action, startOperation } = createReconnectTestAction({
        createdAt: 'not-a-date',
        id: 'ast-1',
      });

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      expect(startOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.not.objectContaining({ startTime: expect.anything() }),
        }),
      );
    });

    // Surfaces that mount the run drawer off the agent route (task detail, home
    // inbox) own an agent the chat store knows nothing about — `activeAgentId` is
    // whatever the last agent page left behind, or undefined on home. Binding the
    // run to it streams every event into a bucket no one renders, so the panel
    // stays frozen even though the WebSocket is live.
    it('binds the run to the caller-provided agent', async () => {
      const { action, startOperation } = createReconnectTestAction({ createdAt: 1, id: 'ast-1' });

      await action.reconnectToGatewayOperation({
        agentId: 'agent-drawer',
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      expect(startOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ agentId: 'agent-drawer', topicId: 'topic-1' }),
        }),
      );
    });

    it('falls back to the active agent when the caller passes none', async () => {
      const { action, startOperation } = createReconnectTestAction({ createdAt: 1, id: 'ast-1' });

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      expect(startOperation).toHaveBeenCalledWith(
        expect.objectContaining({ context: expect.objectContaining({ agentId: 'agent-1' }) }),
      );
    });

    // Captures the onSessionComplete handed to connectToGateway so we can drive
    // both close paths directly. Provides the methods that callback reaches.
    function createOnSessionCompleteHarness({ activeTopicId = 'topic-1' } = {}) {
      const captured: { onSessionComplete?: (p: any) => void } = {};
      const completeOperation = vi.fn();
      const updateTopicStatus = vi.fn();
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-reconnect' }));
      const state: Record<string, any> = {
        activeAgentId: 'agent-1',
        activeTopicId,
        gatewayConnections: {},
        messagesMap: { 'agent-1_topic-1': [{ createdAt: 1, id: 'ast-1' }] },
        topicDataMap: {},
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        completeOperation,
        connectToGateway: (params: any) => {
          captured.onSessionComplete = params.onSessionComplete;
        },
        onOperationCancel: vi.fn(),
        startOperation,
        updateTopicStatus,
      })) as any;

      (globalThis as any).window = {
        global_serverConfigStore: {
          getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
        },
      };
      vi.mocked(aiAgentService.refreshGatewayToken).mockResolvedValue({
        token: 'fresh-token',
      } as any);

      const action = new GatewayActionImpl(set as any, get, undefined);
      action.createClient = vi.fn(() => createMockClient());

      return { action, captured, completeOperation, updateTopicStatus };
    }

    // The core black-hole guard: a reconnect that closes WITHOUT witnessing a
    // real terminal event (e.g. the gateway DO reports a terminal status for a
    // heterogeneous CC op it has no live session for) must NOT clear
    // runningOperation — otherwise the still-running agent's next heteroIngest
    // batch is dropped as stale and it silently stops.
    it('does NOT clear runningOperation on a heterogeneous terminal resume status', async () => {
      const { action, captured, completeOperation, updateTopicStatus } =
        createOnSessionCompleteHarness();

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        heteroType: 'claude-code',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      vi.mocked(topicService.updateTopicMetadata)
        .mockClear()
        .mockResolvedValue(undefined as never);
      captured.onSessionComplete!({
        authFailed: false,
        completion: { source: 'resume_status', status: 'completed' },
        succeeded: false,
        terminalReceived: false,
      });

      expect(completeOperation).toHaveBeenCalledWith('gw-op-reconnect');
      expect(topicService.updateTopicMetadata).not.toHaveBeenCalled();
      expect(updateTopicStatus).not.toHaveBeenCalled();
    });

    it('preserves an unknown rolling marker on terminal resume status', async () => {
      const { action, captured, completeOperation } = createOnSessionCompleteHarness();

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      vi.mocked(topicService.settleRunningOperation).mockClear();
      captured.onSessionComplete!({
        authFailed: false,
        completion: { source: 'resume_status', status: 'completed' },
        succeeded: false,
        terminalReceived: false,
      });

      expect(completeOperation).toHaveBeenCalledWith('gw-op-reconnect');
      expect(topicService.settleRunningOperation).not.toHaveBeenCalled();
    });

    it('settles normal runtime and raw heterogeneous session completions', async () => {
      const normal = createOnSessionCompleteHarness();
      await normal.action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        heteroType: null,
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      vi.mocked(topicService.settleRunningOperation).mockClear();
      normal.captured.onSessionComplete!({
        authFailed: false,
        completion: { source: 'resume_status', status: 'completed' },
        succeeded: false,
        terminalReceived: false,
      });
      expect(normal.completeOperation).toHaveBeenCalledWith('gw-op-reconnect');
      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'active',
      );

      const rawHetero = createOnSessionCompleteHarness();
      await rawHetero.action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        heteroType: 'claude-code',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      vi.mocked(topicService.settleRunningOperation).mockClear();
      rawHetero.captured.onSessionComplete!({
        authFailed: false,
        completion: { source: 'raw_session_complete' },
        succeeded: false,
        terminalReceived: false,
      });
      expect(rawHetero.completeOperation).toHaveBeenCalledWith('gw-op-reconnect');
      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'active',
      );
    });

    // A genuine terminal event (agent_runtime_end / error) still finalizes the
    // run: clear runningOperation so the topic doesn't reconnect forever.
    it('clears runningOperation when a real terminal event was received', async () => {
      const { action, captured, completeOperation } = createOnSessionCompleteHarness();

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      vi.mocked(topicService.settleRunningOperation)
        .mockClear()
        .mockResolvedValue(undefined as never);
      captured.onSessionComplete!({ authFailed: false, succeeded: true, terminalReceived: true });

      // The run lifecycle owns completion when a terminal event arrives, so the
      // reconnect path must not double-complete its local op here.
      expect(completeOperation).not.toHaveBeenCalled();
      // Watching the topic, so the terminal status is 'active' — written by the
      // same server call that clears the marker.
      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'active',
      );
    });

    // auth_failed (or a failed token refresh) is authoritative that the op is
    // gone: clear the stale marker AND complete the local op, so reloads / drawer
    // opens stop reconnecting to a dead operation. Without this the persisted
    // runningOperation lingers forever.
    it('clears runningOperation and completes the local op on auth failure', async () => {
      const { action, captured, completeOperation } = createOnSessionCompleteHarness();

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      vi.mocked(topicService.settleRunningOperation)
        .mockClear()
        .mockResolvedValue(undefined as never);
      captured.onSessionComplete!({ authFailed: true, succeeded: false, terminalReceived: false });

      expect(completeOperation).toHaveBeenCalledWith('gw-op-reconnect');
      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'active',
      );
    });

    // The case that stranded 7 topics on a self-hosted deployment: a run that
    // finishes cleanly while the user is on a DIFFERENT topic.
    //
    // This path used to clear `runningOperation` unconditionally via
    // `updateTopicMetadata` and skip the status write entirely, delegating it to
    // `markTopicUnread` — a separate call on a separate guard. When that one did
    // not land, the topic kept `status: 'running'` forever AND had already lost
    // the marker, so every later `settleRunningOperation` returned 'missing' and
    // no server-side path could repair it. The stuck rows all carried
    // `metadata.runningOperation` present-and-JSON-null, which is what that
    // unconditional clear leaves behind.
    //
    // Reconnect is the path a page refresh takes — hence the symptom always
    // being "still spinning after a reload".
    it('settles to unread (not a bare marker clear) when a clean run ends off-topic', async () => {
      const { action, captured } = createOnSessionCompleteHarness({
        activeTopicId: 'some-other-topic',
      });

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      vi.mocked(topicService.settleRunningOperation)
        .mockClear()
        .mockResolvedValue(undefined as never);
      vi.mocked(topicService.updateTopicMetadata)
        .mockClear()
        .mockResolvedValue(undefined as never);
      captured.onSessionComplete!({ authFailed: false, succeeded: true, terminalReceived: true });

      // One atomic server call carries BOTH the marker clear and the terminal
      // status, under the topic row lock and compared by operation id.
      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'unread',
      );
      // ...and never the unguarded two-step that dropped the status.
      expect(topicService.updateTopicMetadata).not.toHaveBeenCalled();
    });

    it('settles a completed normal resume status to unread when off-topic', async () => {
      const { action, captured } = createOnSessionCompleteHarness({
        activeTopicId: 'some-other-topic',
      });

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        heteroType: null,
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      vi.mocked(topicService.settleRunningOperation)
        .mockClear()
        .mockResolvedValue(undefined as never);
      captured.onSessionComplete!({
        authFailed: false,
        completion: { source: 'resume_status', status: 'completed' },
        succeeded: false,
        terminalReceived: false,
      });

      expect(topicService.settleRunningOperation).toHaveBeenCalledWith(
        'topic-1',
        'server-op-1',
        'unread',
      );
    });

    // Seeds a topic whose local metadata still carries a runningOperation, wires up
    // internal_dispatchTopic + connectToGateway capture, so we can assert the local
    // store clear on both the NOT_FOUND refresh path and onSessionComplete.
    function createSeededReconnectHarness() {
      const captured: { onSessionComplete?: (p: any) => void } = {};
      const connectToGateway = vi.fn((params: any) => {
        captured.onSessionComplete = params.onSessionComplete;
      });
      const internalDispatchTopic = vi.fn();
      const completeOperation = vi.fn();
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-reconnect' }));
      const state: Record<string, any> = {
        activeAgentId: 'agent-1',
        activeTopicId: 'topic-1',
        gatewayConnections: {},
        messagesMap: { 'agent-1_topic-1': [{ createdAt: 1, id: 'ast-1' }] },
        topicDataMap: {
          'agent_agent-1': {
            items: [
              {
                id: 'topic-1',
                metadata: {
                  model: 'gpt-4',
                  runningOperation: { assistantMessageId: 'ast-1', operationId: 'server-op-1' },
                },
              },
            ],
          },
        },
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        completeOperation,
        connectToGateway,
        internal_dispatchTopic: internalDispatchTopic,
        onOperationCancel: vi.fn(),
        startOperation,
        updateTopicStatus: vi.fn(),
      })) as any;

      (globalThis as any).window = {
        global_serverConfigStore: {
          getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
        },
      };
      vi.mocked(aiAgentService.refreshGatewayToken).mockResolvedValue({
        token: 'fresh-token',
      } as any);

      const action = new GatewayActionImpl(set as any, get, undefined);
      action.createClient = vi.fn(() => createMockClient());

      return { action, captured, connectToGateway, internalDispatchTopic };
    }

    // Regression: a stale local runningOperation fires a reconnect,
    // but the server already cleared its marker and answers refreshGatewayToken
    // with TRPC NOT_FOUND. The reconnect must clear the local marker and bail
    // silently (no connect, no throw) so the SWR fetcher resolves instead of
    // looping 404s.
    it('clears the local marker and bails when refreshGatewayToken returns NOT_FOUND', async () => {
      const { action, connectToGateway, internalDispatchTopic } = createSeededReconnectHarness();
      vi.mocked(aiAgentService.refreshGatewayToken).mockRejectedValueOnce({
        data: { code: 'NOT_FOUND' },
      });

      await expect(
        action.reconnectToGatewayOperation({
          assistantMessageId: 'ast-1',
          operationId: 'server-op-1',
          topicId: 'topic-1',
        }),
      ).resolves.toBeUndefined();

      expect(internalDispatchTopic).toHaveBeenCalledWith({
        id: 'topic-1',
        type: 'updateTopic',
        value: { metadata: { model: 'gpt-4', runningOperation: null } },
      });
      expect(connectToGateway).not.toHaveBeenCalled();
    });

    // A non-NOT_FOUND refresh failure is a real error (network, server down): it
    // must rethrow and NOT clear the local marker (the op may still be alive).
    it('rethrows and does not clear the local marker for a non-NOT_FOUND refresh error', async () => {
      const { action, connectToGateway, internalDispatchTopic } = createSeededReconnectHarness();
      vi.mocked(aiAgentService.refreshGatewayToken).mockRejectedValueOnce(
        new Error('network down'),
      );

      await expect(
        action.reconnectToGatewayOperation({
          assistantMessageId: 'ast-1',
          operationId: 'server-op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('network down');

      expect(internalDispatchTopic).not.toHaveBeenCalled();
      expect(connectToGateway).not.toHaveBeenCalled();
    });

    // A reconnect close that PROVES the op is over (real terminal event) must also
    // clear the local store marker, mirroring the server-side updateTopicMetadata.
    it('clears the local marker on a terminal reconnect close', async () => {
      const { action, captured, internalDispatchTopic } = createSeededReconnectHarness();

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      internalDispatchTopic.mockClear();
      vi.mocked(topicService.updateTopicMetadata).mockResolvedValue(undefined as never);
      captured.onSessionComplete!({ authFailed: false, succeeded: false, terminalReceived: true });

      expect(internalDispatchTopic).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: undefined,
        id: 'topic-1',
        type: 'updateTopic',
        value: { metadata: { model: 'gpt-4', runningOperation: null } },
      });
    });

    // A heterogeneous terminal resume status must NOT clear the local marker —
    // same black-hole guard as the server-side clear.
    it('does NOT clear the local marker on a heterogeneous resume status', async () => {
      const { action, captured, internalDispatchTopic } = createSeededReconnectHarness();

      await action.reconnectToGatewayOperation({
        assistantMessageId: 'ast-1',
        heteroType: 'claude-code',
        operationId: 'server-op-1',
        topicId: 'topic-1',
      });

      internalDispatchTopic.mockClear();
      captured.onSessionComplete!({
        authFailed: false,
        completion: { source: 'resume_status', status: 'completed' },
        succeeded: true,
        terminalReceived: false,
      });

      expect(internalDispatchTopic).not.toHaveBeenCalled();
    });
  });
});
