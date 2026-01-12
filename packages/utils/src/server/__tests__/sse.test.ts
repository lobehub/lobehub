import { describe, expect, it, vi } from 'vitest';

import { createSSEHeaders, createSSEWriter, formatSSEEvent } from '../sse';

describe('formatSSEEvent', () => {
  it('should format SSE event with data only', () => {
    const result = formatSSEEvent({ data: 'test message' });

    expect(result).toBe('data: test message\n\n');
  });

  it('should format SSE event with all fields', () => {
    const result = formatSSEEvent({
      data: { message: 'hello' },
      event: 'custom-event',
      id: 'event-123',
      retry: 3000,
    });

    expect(result).toBe(
      'id: event-123\nevent: custom-event\nretry: 3000\ndata: {"message":"hello"}\n\n',
    );
  });

  it('should serialize object data to JSON', () => {
    const result = formatSSEEvent({
      data: { foo: 'bar', count: 42 },
    });

    expect(result).toBe('data: {"foo":"bar","count":42}\n\n');
  });

  it('should handle multi-line string data', () => {
    const result = formatSSEEvent({
      data: 'line1\nline2\nline3',
    });

    expect(result).toBe('data: line1\ndata: line2\ndata: line3\n\n');
  });

  it('should handle empty string data', () => {
    const result = formatSSEEvent({ data: '' });

    expect(result).toBe('data: \n\n');
  });

  it('should format event with id only', () => {
    const result = formatSSEEvent({
      data: 'test',
      id: 'msg-001',
    });

    expect(result).toBe('id: msg-001\ndata: test\n\n');
  });

  it('should format event with event type only', () => {
    const result = formatSSEEvent({
      data: 'test',
      event: 'notification',
    });

    expect(result).toBe('event: notification\ndata: test\n\n');
  });

  it('should format event with retry only', () => {
    const result = formatSSEEvent({
      data: 'test',
      retry: 5000,
    });

    expect(result).toBe('retry: 5000\ndata: test\n\n');
  });

  it('should handle numeric data', () => {
    const result = formatSSEEvent({
      data: 42,
    });

    expect(result).toBe('data: 42\n\n');
  });

  it('should handle boolean data', () => {
    const result = formatSSEEvent({
      data: true,
    });

    expect(result).toBe('data: true\n\n');
  });

  it('should handle null data', () => {
    const result = formatSSEEvent({
      data: null,
    });

    expect(result).toBe('data: null\n\n');
  });

  it('should handle array data', () => {
    const result = formatSSEEvent({
      data: [1, 2, 3],
    });

    expect(result).toBe('data: [1,2,3]\n\n');
  });

  it('should handle nested object data', () => {
    const result = formatSSEEvent({
      data: {
        user: {
          name: 'Alice',
          profile: {
            age: 30,
          },
        },
      },
    });

    expect(result).toBe('data: {"user":{"name":"Alice","profile":{"age":30}}}\n\n');
  });
});

describe('createSSEWriter', () => {
  describe('writeConnection', () => {
    it('should write connection event with required fields', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);
      const timestamp = 1234567890;

      writer.writeConnection('op-123', 'last-event-456', timestamp);

      expect(mockController.enqueue).toHaveBeenCalledWith(
        'id: conn_1234567890\nevent: connected\ndata: {"lastEventId":"last-event-456","operationId":"op-123","timestamp":1234567890,"type":"connected"}\n\n',
      );
    });

    it('should use Date.now() when timestamp is not provided', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);
      const now = Date.now();

      writer.writeConnection('op-456', 'last-789');

      const call = mockController.enqueue.mock.calls[0]![0];
      expect(call).toContain('event: connected');
      expect(call).toContain('"operationId":"op-456"');
      expect(call).toContain('"lastEventId":"last-789"');
      expect(call).toMatch(/"timestamp":\d+/);
    });
  });

  describe('writeError', () => {
    it('should write error event with Error object', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);
      const error = new Error('Something went wrong');
      error.stack = 'Error: Something went wrong\n  at test.ts:10';
      const timestamp = 1234567890;

      writer.writeError(error, 'op-999', 'processing', timestamp);

      expect(mockController.enqueue).toHaveBeenCalledWith(expect.stringContaining('event: error'));
      expect(mockController.enqueue).toHaveBeenCalledWith(
        expect.stringContaining('"error":"Something went wrong"'),
      );
      expect(mockController.enqueue).toHaveBeenCalledWith(
        expect.stringContaining('"phase":"processing"'),
      );
      expect(mockController.enqueue).toHaveBeenCalledWith(
        expect.stringContaining('"stack":"Error: Something went wrong'),
      );
    });

    it('should write error event without stack trace when not available', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);
      const error = new Error('No stack');
      delete error.stack;
      const timestamp = 1234567890;

      writer.writeError(error, 'op-111', 'init', timestamp);

      const call = mockController.enqueue.mock.calls[0]![0];
      expect(call).toContain('event: error');
      expect(call).toContain('"error":"No stack"');
      expect(call).not.toContain('"stack"');
    });

    it('should use "unknown" phase when phase is not provided', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);
      const error = new Error('Test error');
      const timestamp = 1234567890;

      writer.writeError(error, 'op-222', undefined, timestamp);

      expect(mockController.enqueue).toHaveBeenCalledWith(
        expect.stringContaining('"phase":"unknown"'),
      );
    });

    it('should handle string error', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);
      const timestamp = 1234567890;

      writer.writeError('Simple error string', 'op-333', 'validation', timestamp);

      expect(mockController.enqueue).toHaveBeenCalledWith(
        expect.stringContaining('"error":"Simple error string"'),
      );
    });

    it('should use Date.now() when timestamp is not provided', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);
      const error = new Error('Test');

      writer.writeError(error, 'op-444');

      const call = mockController.enqueue.mock.calls[0]![0];
      expect(call).toContain('event: error');
      expect(call).toMatch(/"timestamp":\d+/);
    });
  });

  describe('writeEvent', () => {
    it('should write custom event', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);

      writer.writeEvent({
        data: { custom: 'data' },
        event: 'custom-event',
        id: 'custom-123',
      });

      expect(mockController.enqueue).toHaveBeenCalledWith(
        'id: custom-123\nevent: custom-event\ndata: {"custom":"data"}\n\n',
      );
    });

    it('should write event with retry', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);

      writer.writeEvent({
        data: 'test',
        retry: 10000,
      });

      expect(mockController.enqueue).toHaveBeenCalledWith('retry: 10000\ndata: test\n\n');
    });
  });

  describe('writeHeartbeat', () => {
    it('should write heartbeat event with timestamp', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);
      const timestamp = 1234567890;

      writer.writeHeartbeat(timestamp);

      expect(mockController.enqueue).toHaveBeenCalledWith(
        'id: heartbeat_1234567890\nevent: heartbeat\ndata: {"timestamp":1234567890,"type":"heartbeat"}\n\n',
      );
    });

    it('should use Date.now() when timestamp is not provided', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);

      writer.writeHeartbeat();

      const call = mockController.enqueue.mock.calls[0]![0];
      expect(call).toContain('event: heartbeat');
      expect(call).toMatch(/"timestamp":\d+/);
      expect(call).toMatch(/id: heartbeat_\d+/);
    });
  });

  describe('writeStreamEvent', () => {
    it('should write stream event with custom data', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);

      writer.writeStreamEvent({ type: 'stream_chunk', content: 'hello' }, 'event-555');

      expect(mockController.enqueue).toHaveBeenCalledWith(
        'id: event-555\nevent: stream_chunk\ndata: {"type":"stream_chunk","content":"hello"}\n\n',
      );
    });

    it('should use "stream" as default event type when type is not in data', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);

      writer.writeStreamEvent({ content: 'message' }, 'event-666');

      expect(mockController.enqueue).toHaveBeenCalledWith(
        'id: event-666\nevent: stream\ndata: {"content":"message"}\n\n',
      );
    });

    it('should generate event ID when not provided', () => {
      const mockController = { enqueue: vi.fn() };
      const writer = createSSEWriter(mockController as any);

      writer.writeStreamEvent({ type: 'stream_end' });

      const call = mockController.enqueue.mock.calls[0]![0];
      expect(call).toContain('event: stream_end');
      expect(call).toMatch(/id: event_\d+/);
    });
  });
});

describe('createSSEHeaders', () => {
  it('should create headers with correct SSE configuration', () => {
    const headers = createSSEHeaders();

    expect(headers).toEqual({
      'Access-Control-Allow-Headers': 'Cache-Control, Last-Event-ID',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });
  });

  it('should include CORS headers', () => {
    const headers = createSSEHeaders() as Record<string, string>;

    expect(headers['Access-Control-Allow-Origin']).toBe('*');
    expect(headers['Access-Control-Allow-Methods']).toBe('GET');
    expect(headers['Access-Control-Allow-Headers']).toBe('Cache-Control, Last-Event-ID');
  });

  it('should include cache control headers', () => {
    const headers = createSSEHeaders() as Record<string, string>;

    expect(headers['Cache-Control']).toBe('no-cache, no-transform');
  });

  it('should include SSE-specific headers', () => {
    const headers = createSSEHeaders() as Record<string, string>;

    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Connection']).toBe('keep-alive');
    expect(headers['X-Accel-Buffering']).toBe('no');
  });
});
