import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent } from '@/libs/agent-stream';

import type { GatewayConnection } from '../gateway';
import { GatewayActionImpl } from '../gateway';

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
});
