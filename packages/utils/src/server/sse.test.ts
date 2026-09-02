import { describe, expect, it, vi } from 'vitest';

import { createSSEHeaders, createSSEWriter, formatSSEEvent, type SSEEvent } from './sse';

describe('formatSSEEvent', () => {
  describe('basic data field', () => {
    it('should format a simple string data event', () => {
      const event: SSEEvent = { data: 'hello world' };
      const result = formatSSEEvent(event);
      expect(result).toBe('data: hello world\n\n');
    });

    it('should serialize object data as JSON', () => {
      const event: SSEEvent = { data: { key: 'value', num: 42 } };
      const result = formatSSEEvent(event);
      expect(result).toContain('data: {"key":"value","num":42}');
    });

    it('should serialize array data as JSON', () => {
      const event: SSEEvent = { data: [1, 2, 3] };
      const result = formatSSEEvent(event);
      expect(result).toContain('data: [1,2,3]');
    });

    it('should handle null data as JSON', () => {
      const event: SSEEvent = { data: null };
      const result = formatSSEEvent(event);
      expect(result).toContain('data: null');
    });

    it('should handle numeric data as JSON', () => {
      const event: SSEEvent = { data: 42 };
      const result = formatSSEEvent(event);
      expect(result).toContain('data: 42');
    });

    it('should handle boolean data as JSON', () => {
      const event: SSEEvent = { data: true };
      const result = formatSSEEvent(event);
      expect(result).toContain('data: true');
    });
  });

  describe('multiline data', () => {
    it('should split multiline string data with "data: " prefix per line', () => {
      const event: SSEEvent = { data: 'line1\nline2\nline3' };
      const result = formatSSEEvent(event);
      expect(result).toContain('data: line1\ndata: line2\ndata: line3');
    });

    it('should end with double newline after multiline data', () => {
      const event: SSEEvent = { data: 'line1\nline2' };
      const result = formatSSEEvent(event);
      expect(result.endsWith('\n\n')).toBe(true);
    });
  });

  describe('optional id field', () => {
    it('should include id when provided', () => {
      const event: SSEEvent = { data: 'test', id: 'event-123' };
      const result = formatSSEEvent(event);
      expect(result).toContain('id: event-123\n');
    });

    it('should not include id when not provided', () => {
      const event: SSEEvent = { data: 'test' };
      const result = formatSSEEvent(event);
      expect(result).not.toContain('id:');
    });

    it('should put id before event and data', () => {
      const event: SSEEvent = { data: 'test', event: 'myEvent', id: 'abc' };
      const result = formatSSEEvent(event);
      const idIndex = result.indexOf('id:');
      const eventIndex = result.indexOf('event:');
      const dataIndex = result.indexOf('data:');
      expect(idIndex).toBeLessThan(eventIndex);
      expect(eventIndex).toBeLessThan(dataIndex);
    });
  });

  describe('optional event field', () => {
    it('should include event type when provided', () => {
      const event: SSEEvent = { data: 'test', event: 'message' };
      const result = formatSSEEvent(event);
      expect(result).toContain('event: message\n');
    });

    it('should not include event type when not provided', () => {
      const event: SSEEvent = { data: 'test' };
      const result = formatSSEEvent(event);
      expect(result).not.toContain('event:');
    });
  });

  describe('optional retry field', () => {
    it('should include retry when provided', () => {
      const event: SSEEvent = { data: 'test', retry: 3000 };
      const result = formatSSEEvent(event);
      expect(result).toContain('retry: 3000\n');
    });

    it('should not include retry when not provided', () => {
      const event: SSEEvent = { data: 'test' };
      const result = formatSSEEvent(event);
      expect(result).not.toContain('retry:');
    });
  });

  describe('full event with all fields', () => {
    it('should format a complete event with all fields in correct order', () => {
      const event: SSEEvent = {
        data: { message: 'hello' },
        event: 'update',
        id: '42',
        retry: 1000,
      };
      const result = formatSSEEvent(event);
      expect(result).toBe('id: 42\nevent: update\nretry: 1000\ndata: {"message":"hello"}\n\n');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string data', () => {
      const event: SSEEvent = { data: '' };
      const result = formatSSEEvent(event);
      expect(result).toBe('data: \n\n');
    });

    it('should always end with double newline', () => {
      const result = formatSSEEvent({ data: 'test' });
      expect(result).toMatch(/\n\n$/);
    });
  });
});

describe('createSSEWriter', () => {
  const makeController = () => {
    const enqueued: string[] = [];
    const controller = {
      enqueue: vi.fn((chunk: string) => {
        enqueued.push(chunk);
      }),
    } as unknown as ReadableStreamDefaultController<string>;
    return { controller, enqueued };
  };

  describe('writeEvent', () => {
    it('should enqueue the formatted SSE event', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      writer.writeEvent({ data: 'hello', event: 'test' });
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]).toContain('data: hello');
      expect(enqueued[0]).toContain('event: test');
    });
  });

  describe('writeConnection', () => {
    it('should send a connected event with correct structure', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      const timestamp = 1_700_000_000_000;
      writer.writeConnection('op-123', 'last-event-456', timestamp);

      expect(enqueued).toHaveLength(1);
      const output = enqueued[0];
      expect(output).toContain('event: connected');
      expect(output).toContain(`id: conn_${timestamp}`);
      const dataMatch = output.match(/data: (.+)/);
      expect(dataMatch).not.toBeNull();
      const parsedData = JSON.parse(dataMatch![1]);
      expect(parsedData).toMatchObject({
        lastEventId: 'last-event-456',
        operationId: 'op-123',
        timestamp,
        type: 'connected',
      });
    });

    it('should default timestamp to approximately Date.now()', () => {
      const { controller, enqueued } = makeController();
      const before = Date.now();
      const writer = createSSEWriter(controller);
      writer.writeConnection('op-1', 'ev-1');
      const after = Date.now();

      const output = enqueued[0];
      const dataMatch = output.match(/data: (.+)/);
      const parsedData = JSON.parse(dataMatch![1]);
      expect(parsedData.timestamp).toBeGreaterThanOrEqual(before);
      expect(parsedData.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('writeError', () => {
    it('should send an error event with error message', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      const timestamp = 1_700_000_000_001;
      const error = new Error('something failed');
      writer.writeError(error, 'op-err', 'execution', timestamp);

      const output = enqueued[0];
      expect(output).toContain('event: error');
      expect(output).toContain(`id: error_${timestamp}`);
      const dataMatch = output.match(/data: (.+)/);
      const parsedData = JSON.parse(dataMatch![1]);
      expect(parsedData).toMatchObject({
        operationId: 'op-err',
        timestamp,
        type: 'error',
      });
      expect(parsedData.data.error).toBe('something failed');
      expect(parsedData.data.phase).toBe('execution');
    });

    it('should include stack trace when error has stack', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      const error = new Error('stack test');
      writer.writeError(error, 'op-1', 'init', 1_000);

      const output = enqueued[0];
      const dataMatch = output.match(/data: (.+)/);
      const parsedData = JSON.parse(dataMatch![1]);
      expect(parsedData.data.stack).toBeDefined();
    });

    it('should use "unknown" phase when phase is omitted', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      writer.writeError(new Error('err'), 'op-2', undefined, 2_000);

      const output = enqueued[0];
      const dataMatch = output.match(/data: (.+)/);
      const parsedData = JSON.parse(dataMatch![1]);
      expect(parsedData.data.phase).toBe('unknown');
    });

    it('should handle non-Error objects by converting to string', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      writer.writeError('a plain string error', 'op-3', 'test', 3_000);

      const output = enqueued[0];
      const dataMatch = output.match(/data: (.+)/);
      const parsedData = JSON.parse(dataMatch![1]);
      expect(parsedData.data.error).toBe('a plain string error');
    });
  });

  describe('writeHeartbeat', () => {
    it('should send a heartbeat event', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      const timestamp = 1_700_000_000_002;
      writer.writeHeartbeat(timestamp);

      const output = enqueued[0];
      expect(output).toContain('event: heartbeat');
      expect(output).toContain(`id: heartbeat_${timestamp}`);
      const dataMatch = output.match(/data: (.+)/);
      const parsedData = JSON.parse(dataMatch![1]);
      expect(parsedData).toMatchObject({ timestamp, type: 'heartbeat' });
    });
  });

  describe('writeStreamEvent', () => {
    it('should send a stream event with provided data', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      const eventData = { type: 'stream_chunk', content: 'partial text' };
      writer.writeStreamEvent(eventData, 'ev-stream-1');

      const output = enqueued[0];
      expect(output).toContain('event: stream_chunk');
      expect(output).toContain('id: ev-stream-1');
      const dataMatch = output.match(/data: (.+)/);
      const parsedData = JSON.parse(dataMatch![1]);
      expect(parsedData).toMatchObject(eventData);
    });

    it('should fall back to "stream" event type when data has no type', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      writer.writeStreamEvent({ content: 'text' }, 'ev-2');

      const output = enqueued[0];
      expect(output).toContain('event: stream');
    });

    it('should generate an event id when not provided', () => {
      const { controller, enqueued } = makeController();
      const writer = createSSEWriter(controller);
      writer.writeStreamEvent({ type: 'msg' });

      const output = enqueued[0];
      expect(output).toContain('id: event_');
    });
  });
});

describe('createSSEHeaders', () => {
  it('should return correct content-type for SSE', () => {
    const headers = createSSEHeaders();
    expect((headers as Record<string, string>)['Content-Type']).toBe('text/event-stream');
  });

  it('should set Cache-Control to no-cache', () => {
    const headers = createSSEHeaders();
    expect((headers as Record<string, string>)['Cache-Control']).toContain('no-cache');
  });

  it('should set Connection to keep-alive', () => {
    const headers = createSSEHeaders();
    expect((headers as Record<string, string>)['Connection']).toBe('keep-alive');
  });

  it('should disable nginx buffering', () => {
    const headers = createSSEHeaders();
    expect((headers as Record<string, string>)['X-Accel-Buffering']).toBe('no');
  });

  it('should allow CORS access', () => {
    const headers = createSSEHeaders();
    expect((headers as Record<string, string>)['Access-Control-Allow-Origin']).toBe('*');
  });

  it('should return an object with all expected headers', () => {
    const headers = createSSEHeaders();
    const keys = Object.keys(headers as object);
    expect(keys).toContain('Content-Type');
    expect(keys).toContain('Cache-Control');
    expect(keys).toContain('Connection');
    expect(keys).toContain('X-Accel-Buffering');
    expect(keys).toContain('Access-Control-Allow-Origin');
    expect(keys).toContain('Access-Control-Allow-Methods');
    expect(keys).toContain('Access-Control-Allow-Headers');
  });
});
