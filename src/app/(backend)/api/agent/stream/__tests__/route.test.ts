// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

// Mock dependencies first
const mockStreamEventManager = {
  getStreamHistory: vi.fn(),
  subscribeStreamEvents: vi.fn(),
};

vi.mock('@/server/modules/AgentRuntime', () => ({
  StreamEventManager: vi.fn(() => mockStreamEventManager),
}));

describe('/api/agent/stream route', () => {
  const MOCK_TIMESTAMP = 1758203237000;

  beforeEach(() => {
    vi.resetAllMocks();
    // Mock Date.now to return consistent timestamp
    vi.spyOn(Date, 'now').mockReturnValue(MOCK_TIMESTAMP);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET handler', () => {
    it('should return 400 when operationId parameter is missing', async () => {
      const request = new NextRequest('https://test.com/api/agent/stream');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('operationId parameter is required');
    });

    it('should return SSE stream with correct headers when operationId is provided', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
      expect(response.headers.get('Connection')).toBe('keep-alive');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
        'Cache-Control, Last-Event-ID',
      );
      expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    });
  });

  describe('Stream functionality with exact data verification', () => {
    it('should send connection event in exact SSE format', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation&lastEventId=123',
      );

      const response = await GET(request);
      const decoder = new TextDecoder();
      const reader = response.body!.getReader();

      // Collect all chunks
      const chunks = [];
      let readCount = 0;
      const maxReads = 1; // Only read connection event

      try {
        while (readCount < maxReads) {
          const readPromise = reader.read();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Read timeout')), 1000),
          );

          const result = (await Promise.race([
            readPromise,
            timeoutPromise,
          ])) as ReadableStreamReadResult<Uint8Array>;

          if (result.done) break;
          if (result.value) {
            const chunk =
              result.value instanceof Uint8Array
                ? decoder.decode(result.value)
                : String(result.value);
            chunks.push(chunk);
            readCount++;
          }
        }
      } catch (error) {
        // Timeout or error
      } finally {
        reader.releaseLock();
      }

      // Verify exact stream format with mocked timestamp (new SSE format)
      expect(chunks).toEqual([
        `id: conn_${MOCK_TIMESTAMP}\nevent: connected\ndata: {"lastEventId":"123","operationId":"test-operation","timestamp":${MOCK_TIMESTAMP},"type":"connected"}\n\n`,
      ]);
    });

    it('should verify getStreamHistory with exact historical events format', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation&includeHistory=true&lastEventId=100',
      );

      // Mock getStreamHistory to return specific events
      const mockEvents = [
        {
          type: 'stream_end',
          timestamp: 300,
          operationId: 'test-operation',
          data: { messageId: 'msg3' },
        },
        {
          type: 'stream_chunk',
          timestamp: 250,
          operationId: 'test-operation',
          data: { content: 'world' },
        },
        {
          type: 'stream_start',
          timestamp: 150,
          operationId: 'test-operation',
          data: { messageId: 'msg1' },
        },
      ];
      mockStreamEventManager.getStreamHistory.mockResolvedValue(mockEvents);

      const response = await GET(request);
      const decoder = new TextDecoder();
      const reader = response.body!.getReader();

      // Collect all chunks
      const chunks = [];
      let readCount = 0;
      const maxReads = 3; // connection + 2 filtered historical events (timestamp > 100)

      try {
        while (readCount < maxReads) {
          const readPromise = reader.read();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Read timeout')), 500),
          );

          const result = (await Promise.race([
            readPromise,
            timeoutPromise,
          ])) as ReadableStreamReadResult<Uint8Array>;

          if (result.done) break;
          if (result.value) {
            const chunk =
              result.value instanceof Uint8Array
                ? decoder.decode(result.value)
                : String(result.value);
            chunks.push(chunk);
            readCount++;
          }
        }
      } catch (error) {
        // Timeout or error
      } finally {
        reader.releaseLock();
      }

      // Verify exact stream format - connection event + filtered historical events (new SSE format)
      expect(chunks).toEqual([
        `id: conn_${MOCK_TIMESTAMP}\nevent: connected\ndata: {"lastEventId":"100","operationId":"test-operation","timestamp":${MOCK_TIMESTAMP},"type":"connected"}\n\n`,
        `id: test-operation\nevent: stream_start\ndata: {"type":"stream_start","timestamp":150,"operationId":"test-operation","data":{"messageId":"msg1"}}\n\n`,
        `id: test-operation\nevent: stream_chunk\ndata: {"type":"stream_chunk","timestamp":250,"operationId":"test-operation","data":{"content":"world"}}\n\n`,
      ]);

      // Verify API calls
      expect(mockStreamEventManager.getStreamHistory).toHaveBeenCalledWith('test-operation', 50);
    });

    it('should verify event filtering with exact format', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation&includeHistory=true&lastEventId=200',
      );

      // Mock events where some should be filtered out
      const mockEvents = [
        {
          type: 'stream_end',
          timestamp: 300,
          operationId: 'test-operation',
          data: { messageId: 'msg3' },
        }, // Should be included (300 > 200)
        {
          type: 'stream_chunk',
          timestamp: 250,
          operationId: 'test-operation',
          data: { content: 'world' },
        }, // Should be included (250 > 200)
        {
          type: 'stream_chunk',
          timestamp: 200,
          operationId: 'test-operation',
          data: { content: 'hello' },
        }, // Should be excluded (200 = 200)
        {
          type: 'stream_start',
          timestamp: 150,
          operationId: 'test-operation',
          data: { messageId: 'msg1' },
        }, // Should be excluded (150 < 200)
      ];
      mockStreamEventManager.getStreamHistory.mockResolvedValue(mockEvents);

      const response = await GET(request);
      const decoder = new TextDecoder();
      const reader = response.body!.getReader();

      // Collect all chunks
      const chunks = [];
      let readCount = 0;
      const maxReads = 3; // connection + 2 filtered events

      try {
        while (readCount < maxReads) {
          const readPromise = reader.read();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Read timeout')), 500),
          );

          const result = (await Promise.race([
            readPromise,
            timeoutPromise,
          ])) as ReadableStreamReadResult<Uint8Array>;

          if (result.done) break;
          if (result.value) {
            const chunk =
              result.value instanceof Uint8Array
                ? decoder.decode(result.value)
                : String(result.value);
            chunks.push(chunk);
            readCount++;
          }
        }
      } catch (error) {
        // Timeout or error
      } finally {
        reader.releaseLock();
      }

      // Verify exact stream format - only events with timestamp > 200 are included (new SSE format)
      // Note: indices are based on original array position, not filtered position
      expect(chunks).toEqual([
        `id: conn_${MOCK_TIMESTAMP}
event: connected
data: {"lastEventId":"200","operationId":"test-operation","timestamp":${MOCK_TIMESTAMP},"type":"connected"}

`,
        `id: test-operation
event: stream_chunk
data: {"type":"stream_chunk","timestamp":250,"operationId":"test-operation","data":{"content":"world"}}

`,
        `id: test-operation
event: stream_end
data: {"type":"stream_end","timestamp":300,"operationId":"test-operation","data":{"messageId":"msg3"}}
\n`,
      ]);

      // Verify API calls
      expect(mockStreamEventManager.getStreamHistory).toHaveBeenCalledWith('test-operation', 50);
    });

    it('should handle errors with exact error event format', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation&includeHistory=true',
      );

      // Mock getStreamHistory to reject
      mockStreamEventManager.getStreamHistory.mockRejectedValue(
        new Error('Redis connection failed'),
      );

      const response = await GET(request);
      const decoder = new TextDecoder();
      const reader = response.body!.getReader();

      // Collect all chunks
      const chunks = [];
      let readCount = 0;
      const maxReads = 2; // connection + error event

      try {
        while (readCount < maxReads) {
          const readPromise = reader.read();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Read timeout')), 500),
          );

          const result = (await Promise.race([
            readPromise,
            timeoutPromise,
          ])) as ReadableStreamReadResult<Uint8Array>;

          if (result.done) break;
          if (result.value) {
            const chunk =
              result.value instanceof Uint8Array
                ? decoder.decode(result.value)
                : String(result.value);
            chunks.push(chunk);
            readCount++;
          }
        }
      } catch (error) {
        // Timeout or error
      } finally {
        reader.releaseLock();
      }

      // Verify exact stream format - connection event + error event (new SSE format)
      // Parse error event to check format (error includes stack trace dynamically)
      const errorChunk = chunks[1];
      expect(errorChunk).toMatch(/^id: error_\d+\nevent: error\ndata: \{.*"type":"error".*\}\n\n$/);
      expect(errorChunk).toContain('"error":"Redis connection failed"');
      expect(errorChunk).toContain('"phase":"history_loading"');
      expect(errorChunk).toContain('"operationId":"test-operation"');
      expect(errorChunk).toContain(`"timestamp":${MOCK_TIMESTAMP}`);

      // Verify connection event format
      expect(chunks[0]).toEqual(
        `id: conn_${MOCK_TIMESTAMP}\nevent: connected\ndata: {"lastEventId":"0","operationId":"test-operation","timestamp":${MOCK_TIMESTAMP},"type":"connected"}\n\n`,
      );

      // Verify getStreamHistory was called
      expect(mockStreamEventManager.getStreamHistory).toHaveBeenCalledWith('test-operation', 50);
    });

    it('should verify stream subscription with exact parameters', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation&lastEventId=456',
      );

      mockStreamEventManager.subscribeStreamEvents.mockResolvedValue(undefined);

      const response = await GET(request);

      expect(response.status).toBe(200);

      // Verify exact parameter passing
      expect(mockStreamEventManager.subscribeStreamEvents).toHaveBeenCalledWith(
        'test-operation',
        '456',
        expect.any(Function), // callback function
        expect.any(AbortSignal), // abort signal
      );

      // Verify the callback function structure
      const callArgs = mockStreamEventManager.subscribeStreamEvents.mock.calls[0];
      expect(callArgs).toHaveLength(4);
      expect(typeof callArgs[2]).toBe('function'); // callback
      expect(callArgs[3]).toBeInstanceOf(AbortSignal); // signal
    });

    it('should verify default parameters with exact values', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      mockStreamEventManager.subscribeStreamEvents.mockResolvedValue(undefined);

      const response = await GET(request);

      expect(response.status).toBe(200);

      // Verify default values are used
      expect(mockStreamEventManager.subscribeStreamEvents).toHaveBeenCalledWith(
        'test-operation',
        '0', // default lastEventId
        expect.any(Function),
        expect.any(AbortSignal),
      );

      // Verify getStreamHistory is NOT called when includeHistory defaults to false
      expect(mockStreamEventManager.getStreamHistory).not.toHaveBeenCalled();
    });

    it('should verify SSE message structure with exact format specification', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      const response = await GET(request);
      const decoder = new TextDecoder();
      const reader = response.body!.getReader();

      // Collect all chunks
      const chunks = [];
      let readCount = 0;
      const maxReads = 1; // Only read connection event

      try {
        while (readCount < maxReads) {
          const readPromise = reader.read();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Read timeout')), 1000),
          );

          const result = (await Promise.race([
            readPromise,
            timeoutPromise,
          ])) as ReadableStreamReadResult<Uint8Array>;

          if (result.done) break;
          if (result.value) {
            const chunk =
              result.value instanceof Uint8Array
                ? decoder.decode(result.value)
                : String(result.value);
            chunks.push(chunk);
            readCount++;
          }
        }
      } catch (error) {
        // Timeout or error
      } finally {
        reader.releaseLock();
      }

      // Verify exact stream format with default lastEventId (new SSE format)
      expect(chunks).toEqual([
        `id: conn_${MOCK_TIMESTAMP}\nevent: connected\ndata: {"lastEventId":"0","operationId":"test-operation","timestamp":${MOCK_TIMESTAMP},"type":"connected"}\n\n`,
      ]);
    });
  });

  describe('Agent Runtime Lifecycle', () => {
    it('should verify agent runtime event handling and connection closure logic', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      // Capture the event callback so we can test the event processing logic directly
      let capturedCallback: ((events: any[]) => void) | null = null;
      let capturedSignal: AbortSignal | null = null;

      mockStreamEventManager.subscribeStreamEvents.mockImplementation(
        (operationId, lastEventId, callback, signal) => {
          capturedCallback = callback;
          capturedSignal = signal;
          return Promise.resolve();
        },
      );

      const response = await GET(request);

      // Verify the subscription was set up correctly
      expect(mockStreamEventManager.subscribeStreamEvents).toHaveBeenCalledWith(
        'test-operation',
        '0',
        expect.any(Function),
        expect.any(AbortSignal),
      );
      expect(capturedCallback).toBeDefined();
      expect(capturedSignal).toBeDefined();

      // Verify response headers are correct
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      // Test that the callback exists and can be called
      expect(typeof capturedCallback).toBe('function');
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });

    it('should verify subscribeStreamEvents callback can handle agent_runtime_init events', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      let capturedCallback: ((events: any[]) => void) | null = null;

      mockStreamEventManager.subscribeStreamEvents.mockImplementation(
        (operationId, lastEventId, callback, signal) => {
          capturedCallback = callback;
          return Promise.resolve();
        },
      );

      const response = await GET(request);

      // Verify we captured the callback
      expect(capturedCallback).toBeDefined();
      expect(response.status).toBe(200);

      // Test agent_runtime_init event processing
      const initEvent = {
        type: 'agent_runtime_init',
        timestamp: MOCK_TIMESTAMP + 100,
        operationId: 'test-operation',
        data: {
          userId: 'user-123',
          modelConfig: { model: 'gpt-4', temperature: 0.7 },
          agentType: 'assistant',
        },
      };

      // The callback should be callable without throwing errors
      expect(() => capturedCallback!([initEvent])).not.toThrow();
    });

    it('should verify subscribeStreamEvents callback can handle agent_runtime_end events', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      let capturedCallback: ((events: any[]) => void) | null = null;

      mockStreamEventManager.subscribeStreamEvents.mockImplementation(
        (operationId, lastEventId, callback, signal) => {
          capturedCallback = callback;
          return Promise.resolve();
        },
      );

      const response = await GET(request);

      // Verify we captured the callback
      expect(capturedCallback).toBeDefined();
      expect(response.status).toBe(200);

      // Test agent_runtime_end event processing
      const endEvent = {
        type: 'agent_runtime_end',
        timestamp: MOCK_TIMESTAMP + 600,
        operationId: 'test-operation',
        data: {
          totalSteps: 1,
          executionTime: 500,
          status: 'completed',
        },
      };

      // The callback should be callable without throwing errors
      expect(() => capturedCallback!([endEvent])).not.toThrow();
    });

    it('should verify complete agent runtime lifecycle event types are supported', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      let capturedCallback: ((events: any[]) => void) | null = null;

      mockStreamEventManager.subscribeStreamEvents.mockImplementation(
        (operationId, lastEventId, callback, signal) => {
          capturedCallback = callback;
          return Promise.resolve();
        },
      );

      const response = await GET(request);

      expect(capturedCallback).toBeDefined();
      expect(response.status).toBe(200);

      // Test complete lifecycle events can be processed
      const lifecycleEvents = [
        {
          type: 'agent_runtime_init',
          timestamp: MOCK_TIMESTAMP + 100,
          operationId: 'test-operation',
          data: { userId: 'user-123', agentType: 'assistant' },
        },
        {
          type: 'stream_start',
          timestamp: MOCK_TIMESTAMP + 200,
          operationId: 'test-operation',
          data: { messageId: 'msg-001' },
        },
        {
          type: 'stream_chunk',
          timestamp: MOCK_TIMESTAMP + 300,
          operationId: 'test-operation',
          data: { content: 'Hello world' },
        },
        {
          type: 'stream_end',
          timestamp: MOCK_TIMESTAMP + 400,
          operationId: 'test-operation',
          data: { messageId: 'msg-001' },
        },
        {
          type: 'agent_runtime_end',
          timestamp: MOCK_TIMESTAMP + 500,
          operationId: 'test-operation',
          data: { status: 'completed', totalSteps: 1 },
        },
      ];

      // All lifecycle events should be processable without throwing errors
      expect(() => capturedCallback!(lifecycleEvents)).not.toThrow();
    });
  });

  describe('Heartbeat and connection lifecycle', () => {
    it('should close connection immediately after agent_runtime_end', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      let capturedCallback: ((events: any[]) => void) | null = null;
      let capturedSignal: AbortSignal | null = null;

      mockStreamEventManager.subscribeStreamEvents.mockImplementation(
        (operationId, lastEventId, callback, signal) => {
          capturedCallback = callback;
          capturedSignal = signal;
          return new Promise(() => {});
        },
      );

      const response = await GET(request);

      expect(capturedCallback).toBeDefined();
      expect(capturedSignal).toBeDefined();

      // Signal should not be aborted initially
      expect(capturedSignal!.aborted).toBe(false);

      // Simulate agent_runtime_end event
      const endEvent = {
        type: 'agent_runtime_end',
        timestamp: MOCK_TIMESTAMP + 1000,
        operationId: 'test-operation',
        data: { status: 'completed' },
      };
      capturedCallback!([endEvent]);

      // Signal should be aborted immediately after agent_runtime_end
      expect(capturedSignal!.aborted).toBe(true);
    });

    it('should set streamEnded flag and close connection when agent_runtime_end is received', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      let capturedCallback: ((events: any[]) => void) | null = null;
      let capturedSignal: AbortSignal | null = null;

      mockStreamEventManager.subscribeStreamEvents.mockImplementation(
        (operationId, lastEventId, callback, signal) => {
          capturedCallback = callback;
          capturedSignal = signal;
          return new Promise(() => {});
        },
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(capturedCallback).toBeDefined();
      expect(capturedSignal).toBeDefined();

      // Simulate agent_runtime_end event - this should set streamEnded = true
      const endEvent = {
        type: 'agent_runtime_end',
        timestamp: MOCK_TIMESTAMP + 1000,
        operationId: 'test-operation',
        data: { status: 'completed' },
      };

      // This should not throw - verifies the callback can handle the event
      expect(() => capturedCallback!([endEvent])).not.toThrow();
      // Signal should be aborted (connection closed)
      expect(capturedSignal!.aborted).toBe(true);
    });

    it('should handle agent_runtime_end event in callback without errors', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      let capturedCallback: ((events: any[]) => void) | null = null;

      mockStreamEventManager.subscribeStreamEvents.mockImplementation(
        (operationId, lastEventId, callback, signal) => {
          capturedCallback = callback;
          return new Promise(() => {});
        },
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(capturedCallback).toBeDefined();

      // Simulate agent_runtime_end with full data
      const endEvent = {
        type: 'agent_runtime_end',
        timestamp: MOCK_TIMESTAMP + 1000,
        operationId: 'test-operation',
        data: {
          finalState: { status: 'completed' },
          reason: 'completed',
          reasonDetail: 'Agent runtime completed successfully',
        },
      };

      // Verify the event is processed without throwing
      expect(() => capturedCallback!([endEvent])).not.toThrow();
    });

    it('should handle batch events including agent_runtime_end without errors', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      let capturedCallback: ((events: any[]) => void) | null = null;

      mockStreamEventManager.subscribeStreamEvents.mockImplementation(
        (operationId, lastEventId, callback, signal) => {
          capturedCallback = callback;
          return new Promise(() => {});
        },
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(capturedCallback).toBeDefined();

      // Simulate batch of events ending with agent_runtime_end
      const batchEvents = [
        {
          type: 'stream_chunk',
          timestamp: MOCK_TIMESTAMP + 800,
          operationId: 'test-operation',
          data: { content: 'Final chunk' },
        },
        {
          type: 'stream_end',
          timestamp: MOCK_TIMESTAMP + 900,
          operationId: 'test-operation',
          data: { messageId: 'msg-001' },
        },
        {
          type: 'agent_runtime_end',
          timestamp: MOCK_TIMESTAMP + 1000,
          operationId: 'test-operation',
          data: { status: 'completed' },
        },
      ];

      // All events should be processed without throwing
      expect(() => capturedCallback!(batchEvents)).not.toThrow();
    });

    it('should skip events after streamEnded flag is set', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test-operation',
      );

      let capturedCallback: ((events: any[]) => void) | null = null;
      let capturedSignal: AbortSignal | null = null;

      mockStreamEventManager.subscribeStreamEvents.mockImplementation(
        (operationId, lastEventId, callback, signal) => {
          capturedCallback = callback;
          capturedSignal = signal;
          return new Promise(() => {});
        },
      );

      await GET(request);

      expect(capturedCallback).toBeDefined();
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);

      // First, send agent_runtime_end to set streamEnded = true
      capturedCallback!([
        {
          type: 'agent_runtime_end',
          timestamp: MOCK_TIMESTAMP + 1000,
          operationId: 'test-operation',
          data: { status: 'completed' },
        },
      ]);

      // Signal should be aborted immediately
      expect(capturedSignal!.aborted).toBe(true);

      // Any subsequent events should be skipped (no errors)
      expect(() =>
        capturedCallback!([
          {
            type: 'step_complete',
            timestamp: MOCK_TIMESTAMP + 1100,
            operationId: 'test-operation',
            data: { stepIndex: 1 },
          },
        ]),
      ).not.toThrow();
    });
  });

  describe('Parameter validation', () => {
    it('should handle operationId with special characters', async () => {
      const operationId = 'test-operation-123_456';
      const request = new NextRequest(
        `https://test.com/api/agent/stream?operationId=${operationId}`,
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it('should handle lastEventId as string number', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test&lastEventId=12345',
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it('should handle includeHistory as string boolean', async () => {
      const request = new NextRequest(
        'https://test.com/api/agent/stream?operationId=test&includeHistory=false',
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockStreamEventManager.getStreamHistory).not.toHaveBeenCalled();
    });

    it('should handle invalid URL gracefully', async () => {
      const request = new NextRequest('https://test.com/api/agent/stream?operationId=');

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('operationId parameter is required');
    });
  });
});
