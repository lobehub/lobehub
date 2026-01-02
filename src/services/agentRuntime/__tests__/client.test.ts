// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuntimeClient } from '../client';

// Mock fetchEventSource
const mockFetchEventSource = vi.fn();
vi.mock('@lobechat/utils/client', () => ({
  fetchEventSource: (url: string, options: any) => mockFetchEventSource(url, options),
}));

describe('AgentRuntimeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createStreamConnection', () => {
    it('should create connection with correct URL and parameters', () => {
      const operationId = 'agent_1758302563222_0g28qmdmu';

      agentRuntimeClient.createStreamConnection(operationId, {
        includeHistory: false,
        lastEventId: '0',
      });

      expect(mockFetchEventSource).toHaveBeenCalledWith(
        '/api/agent/stream?includeHistory=false&lastEventId=0&operationId=agent_1758302563222_0g28qmdmu',
        expect.objectContaining({
          headers: {
            'Cache-Control': 'no-cache',
            'Last-Event-ID': '0',
          },
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('should handle complete agent runtime lifecycle with real stream data', async () => {
      const operationId = 'agent_1758302563222_abc';
      const events: any[] = [];
      let connectCalled = false;
      let disconnectCalled = false;

      // Capture the callbacks passed to fetchEventSource
      mockFetchEventSource.mockImplementation((url: string, options: any) => {
        // Simulate connection opening
        setTimeout(() => {
          options.onopen?.({ ok: true, status: 200, statusText: 'OK' });
        }, 10);

        // Simulate receiving events
        setTimeout(() => {
          const streamEvents = [
            `{"lastEventId":"0","operationId":"${operationId}","timestamp":1758302567925,"type":"connected"}`,
            `{"type":"agent_runtime_init","stepIndex":0,"operationId":"${operationId}","data":{"agentConfig":{"enableSearch":true}},"timestamp":1758302564421}`,
            `{"type":"stream_start","stepIndex":0,"operationId":"${operationId}","data":{"messageId":"msg1","model":"gpt-4"},"timestamp":1758302574552}`,
            `{"type":"stream_chunk","stepIndex":0,"operationId":"${operationId}","data":{"content":"Hello"},"timestamp":1758302578042}`,
            `{"type":"stream_end","stepIndex":0,"operationId":"${operationId}","data":{"finalContent":"Hello world"},"timestamp":1758302626595}`,
            `{"type":"agent_runtime_end","stepIndex":0,"operationId":"${operationId}","data":{"status":"completed"},"timestamp":1758302631030}`,
          ];

          streamEvents.forEach((eventData) => {
            options.onmessage?.({ data: eventData, event: 'message' });
          });
        }, 20);
      });

      agentRuntimeClient.createStreamConnection(operationId, {
        includeHistory: false,
        onConnect: () => {
          connectCalled = true;
        },
        onDisconnect: () => {
          disconnectCalled = true;
        },
        onEvent: (event) => {
          events.push(event);
        },
      });

      // Wait for all events
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(connectCalled).toBe(true);
      expect(events).toHaveLength(6);

      // Verify event sequence
      expect(events[0].type).toBe('connected');
      expect(events[1].type).toBe('agent_runtime_init');
      expect(events[2].type).toBe('stream_start');
      expect(events[3].type).toBe('stream_chunk');
      expect(events[4].type).toBe('stream_end');
      expect(events[5].type).toBe('agent_runtime_end');

      // Verify operationId consistency
      events.forEach((event) => {
        expect(event.operationId).toBe(operationId);
      });
    });

    it('should handle heartbeat events correctly', async () => {
      const operationId = 'test-operation';
      const events: any[] = [];

      mockFetchEventSource.mockImplementation((url: string, options: any) => {
        setTimeout(() => {
          const heartbeatData = `{"operationId":"${operationId}","timestamp":1758302597927,"type":"heartbeat"}`;
          options.onmessage?.({ data: heartbeatData, event: 'message' });
        }, 10);
      });

      agentRuntimeClient.createStreamConnection(operationId, {
        onEvent: (event) => {
          events.push(event);
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('heartbeat');
      expect(events[0].operationId).toBe(operationId);
    });

    it('should handle connection errors', async () => {
      const operationId = 'test-operation';
      let errorOccurred = false;

      mockFetchEventSource.mockImplementation((url: string, options: any) => {
        setTimeout(() => {
          options.onerror?.(new Error('Connection failed'));
        }, 10);
      });

      agentRuntimeClient.createStreamConnection(operationId, {
        onError: (error) => {
          errorOccurred = true;
          expect(error.message).toBe('Connection failed');
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(errorOccurred).toBe(true);
    });

    it('should handle malformed JSON gracefully', async () => {
      const operationId = 'test-operation';
      const events: any[] = [];
      let errorOccurred = false;

      mockFetchEventSource.mockImplementation((url: string, options: any) => {
        setTimeout(() => {
          options.onmessage?.({ data: 'invalid json', event: 'message' });
        }, 10);
      });

      agentRuntimeClient.createStreamConnection(operationId, {
        onEvent: (event) => {
          events.push(event);
        },
        onError: (error) => {
          errorOccurred = true;
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(events).toHaveLength(0);
      expect(errorOccurred).toBe(true);
    });

    it('should call onDisconnect when connection is closed', async () => {
      const operationId = 'test-operation';
      let disconnectCalled = false;

      mockFetchEventSource.mockImplementation((url: string, options: any) => {
        setTimeout(() => {
          options.onclose?.();
        }, 10);
      });

      agentRuntimeClient.createStreamConnection(operationId, {
        onDisconnect: () => {
          disconnectCalled = true;
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(disconnectCalled).toBe(true);
    });

    it('should include correct parameters in URL', () => {
      const operationId = 'test-operation-123';

      agentRuntimeClient.createStreamConnection(operationId, {
        includeHistory: true,
        lastEventId: '12345',
      });

      expect(mockFetchEventSource).toHaveBeenCalledWith(
        '/api/agent/stream?includeHistory=true&lastEventId=12345&operationId=test-operation-123',
        expect.any(Object),
      );
    });

    it('should use default parameters when not provided', () => {
      const operationId = 'test-operation';

      agentRuntimeClient.createStreamConnection(operationId);

      expect(mockFetchEventSource).toHaveBeenCalledWith(
        '/api/agent/stream?includeHistory=false&lastEventId=0&operationId=test-operation',
        expect.any(Object),
      );
    });

    it('should return AbortController for cancellation', () => {
      const operationId = 'test-operation';

      const controller = agentRuntimeClient.createStreamConnection(operationId);

      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
