import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent } from '@/libs/agent-stream';
import { aiAgentService } from '@/services/aiAgent';

import type { GatewayConnection } from '../gateway';
import { GatewayActionImpl } from '../gateway';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execAgentTask: vi.fn(),
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
    sendInterrupt: vi.fn(),
  };
}

// ─── Test Helpers ───

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
      });

      mockClient.emitEvent('auth_failed', 'invalid token');
      expect(state.gatewayConnections['op-1']).toBeUndefined();
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
      });

      // Second connection
      const secondMock = createMockClient();
      action.createClient = vi.fn(() => secondMock);
      action.connectToGateway({
        gatewayUrl: 'https://gateway.test.com',
        operationId: 'op-1',
        token: 'token-2',
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
  });
});
