import { afterEach, describe, expect, it, vi } from 'vitest';

import { SSE_HEARTBEAT_INTERVAL_MS, StreamingResponse } from './response';

const createClosedStream = () =>
  new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

describe('StreamingResponse', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create Response with default headers', () => {
    const mockStream = createClosedStream();
    const response = StreamingResponse(mockStream);

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should create Response with custom headers', () => {
    const mockStream = createClosedStream();
    const customHeaders = {
      'Custom-Header': 'custom-value',
      'Authorization': 'Bearer token',
    };

    const response = StreamingResponse(mockStream, { headers: customHeaders });

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBeInstanceOf(ReadableStream);

    // Default headers should still be present
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');

    // Custom headers should be added
    expect(response.headers.get('Custom-Header')).toBe('custom-value');
    expect(response.headers.get('Authorization')).toBe('Bearer token');
  });

  it('should allow custom headers to override default headers', () => {
    const mockStream = createClosedStream();
    const overrideHeaders = {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=3600',
    };

    const response = StreamingResponse(mockStream, { headers: overrideHeaders });

    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('max-age=3600');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should handle empty options object', () => {
    const mockStream = createClosedStream();
    const response = StreamingResponse(mockStream, {});

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should handle options with empty headers', () => {
    const mockStream = createClosedStream();
    const response = StreamingResponse(mockStream, { headers: {} });

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should work with actual ReadableStream data', async () => {
    const testData = 'data: {"test": "value"}\n\n';
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(testData));
        controller.close();
      },
    });

    const response = StreamingResponse(stream);
    const responseText = await response.text();

    expect(responseText).toBe(testData);
  });

  it('should emit heartbeat events while the upstream stream is idle', async () => {
    vi.useFakeTimers();

    const upstream = new ReadableStream<Uint8Array>();
    const response = StreamingResponse(upstream);
    const reader = response.body!.getReader();
    const heartbeatPromise = reader.read();

    await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_INTERVAL_MS);

    const heartbeat = await heartbeatPromise;
    expect(heartbeat.done).toBe(false);
    expect(new TextDecoder().decode(heartbeat.value)).toBe('event: heartbeat\ndata: {}\n\n');

    await reader.cancel();
  });

  it('should cancel the upstream stream when the response body is canceled', async () => {
    const cancel = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({ cancel });
    const response = StreamingResponse(upstream);

    await response.body!.cancel('user abort');

    expect(cancel).toHaveBeenCalledWith('user abort');
  });
});
