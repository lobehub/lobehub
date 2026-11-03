import { describe, expect, it } from 'vitest';

import { StreamingResponse } from './response';

describe('StreamingResponse', () => {
  it('should create Response with default headers', () => {
    const mockStream = new ReadableStream();
    const response = StreamingResponse(mockStream);

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBe(mockStream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should create Response with custom headers', () => {
    const mockStream = new ReadableStream();
    const customHeaders = {
      'Custom-Header': 'custom-value',
      'Authorization': 'Bearer token',
    };

    const response = StreamingResponse(mockStream, { headers: customHeaders });

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBe(mockStream);

    // Default headers should still be present
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');

    // Custom headers should be added
    expect(response.headers.get('Custom-Header')).toBe('custom-value');
    expect(response.headers.get('Authorization')).toBe('Bearer token');
  });

  it('should allow custom headers to override default headers', () => {
    const mockStream = new ReadableStream();
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
    const mockStream = new ReadableStream();
    const response = StreamingResponse(mockStream, {});

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBe(mockStream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should handle options with empty headers', () => {
    const mockStream = new ReadableStream();
    const response = StreamingResponse(mockStream, { headers: {} });

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBe(mockStream);
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
});
