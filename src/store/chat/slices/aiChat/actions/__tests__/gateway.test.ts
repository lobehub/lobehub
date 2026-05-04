import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';

import type { GatewayConnection } from '../gateway';
import { GatewayActionImpl } from '../gateway';

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
    updateTopicMetadata: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: vi.fn(() => ({ preference: { lab: {} } })),
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
  afterEach(() => {
    vi.restoreAllMocks();
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

      mockClient.emitEvent('session_complete');
      expect(state.gatewayConnections['op-1']).toBeUndefined();
      expect(onComplete).toHaveBeenCalledOnce();
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
      const state: Record<string, any> = { gatewayConnections: {} };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') {
          Object.assign(state, updater(state));
        } else {
          Object.assign(state, updater);
        }
      });

      const get = vi.fn(() => ({
        ...state,
        startOperation: vi.fn(() => ({ operationId: 'gw-op-1' })),
        associateMessageWithOperation: vi.fn(),
        connectToGateway: vi.fn(),
        internal_updateTopicLoading: vi.fn(),
        onOperationCancel: vi.fn(),
        replaceMessages: vi.fn(),
        switchTopic: vi.fn(),
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

      return { action, get, mockClient, set, state };
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
      );
    });

    it('registers a cancel handler that calls aiAgentService.interruptTask with the server operationId', async () => {
      const onOperationCancel = vi.fn();
      const startOperation = vi.fn(() => ({ operationId: 'gw-op-local' }));

      const mockClient = createMockClient();
      const state: Record<string, any> = { gatewayConnections: {} };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') Object.assign(state, updater(state));
        else Object.assign(state, updater);
      });
      const get = vi.fn(() => ({
        ...state,
        associateMessageWithOperation: vi.fn(),
        connectToGateway: vi.fn(),
        internal_updateTopicLoading: vi.fn(),
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
      expect(interruptTaskSpy).toHaveBeenCalledWith({ operationId: 'server-op-xyz' });
    });
  });
});
