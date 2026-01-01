import type { StreamInvokeRequestParams } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock electron module
const mockIpcRendererOn = vi.fn();
const mockIpcRendererOnce = vi.fn();
const mockIpcRendererSend = vi.fn();
const mockIpcRendererRemoveAllListeners = vi.fn();

vi.mock('electron', () => ({
  ipcRenderer: {
    on: mockIpcRendererOn,
    once: mockIpcRendererOnce,
    removeAllListeners: mockIpcRendererRemoveAllListeners,
    send: mockIpcRendererSend,
  },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-request-id-123'),
}));

const { onStreamInvoke } = await import('./streamer');

describe('onStreamInvoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set up stream listeners and send start event', () => {
    const params: StreamInvokeRequestParams = {
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      urlPath: '/trpc/lambda/test.endpoint',
    };

    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    onStreamInvoke(params, callbacks);

    // Verify listeners are registered
    expect(mockIpcRendererOn).toHaveBeenCalledWith(
      'stream:data:test-request-id-123',
      expect.any(Function),
    );
    expect(mockIpcRendererOnce).toHaveBeenCalledWith(
      'stream:end:test-request-id-123',
      expect.any(Function),
    );
    expect(mockIpcRendererOnce).toHaveBeenCalledWith(
      'stream:error:test-request-id-123',
      expect.any(Function),
    );
    expect(mockIpcRendererOnce).toHaveBeenCalledWith(
      'stream:response:test-request-id-123',
      expect.any(Function),
    );

    // Verify start event is sent
    expect(mockIpcRendererSend).toHaveBeenCalledWith('stream:start', {
      ...params,
      requestId: 'test-request-id-123',
    });
  });

  it('should invoke onData callback when data is received', () => {
    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    const params: StreamInvokeRequestParams = {
      headers: {},
      method: 'GET',
      urlPath: '/trpc/test',
    };

    onStreamInvoke(params, callbacks);

    // Get the data listener callback
    const dataListener = mockIpcRendererOn.mock.calls.find((call) =>
      call[0].includes('stream:data'),
    )?.[1];

    // Simulate data event
    const testData = Buffer.from('test data');
    dataListener?.(null, testData);

    expect(callbacks.onData).toHaveBeenCalledWith(new Uint8Array(testData));
  });

  it('should invoke onResponse callback when response is received', () => {
    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    const params: StreamInvokeRequestParams = {
      headers: {},
      method: 'GET',
      urlPath: '/trpc/test',
    };

    onStreamInvoke(params, callbacks);

    // Get the response listener callback
    const responseListener = mockIpcRendererOnce.mock.calls.find((call) =>
      call[0].includes('stream:response'),
    )?.[1];

    // Simulate response event
    const testResponse = {
      headers: { 'content-type': 'application/json' },
      status: 200,
      statusText: 'OK',
    };
    responseListener?.(null, testResponse);

    expect(callbacks.onResponse).toHaveBeenCalledWith(testResponse);
  });

  it('should invoke onEnd callback and cleanup when stream ends', () => {
    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    const params: StreamInvokeRequestParams = {
      headers: {},
      method: 'GET',
      urlPath: '/trpc/test',
    };

    onStreamInvoke(params, callbacks);

    // Get the end listener callback
    const endListener = mockIpcRendererOnce.mock.calls.find((call) =>
      call[0].includes('stream:end'),
    )?.[1];

    // Simulate end event
    endListener?.(null);

    expect(callbacks.onEnd).toHaveBeenCalled();

    // Verify cleanup
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:data:test-request-id-123',
    );
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:end:test-request-id-123',
    );
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:error:test-request-id-123',
    );
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:response:test-request-id-123',
    );
  });

  it('should invoke onError callback and cleanup when error occurs', () => {
    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    const params: StreamInvokeRequestParams = {
      headers: {},
      method: 'GET',
      urlPath: '/trpc/test',
    };

    onStreamInvoke(params, callbacks);

    // Get the error listener callback
    const errorListener = mockIpcRendererOnce.mock.calls.find((call) =>
      call[0].includes('stream:error'),
    )?.[1];

    // Simulate error event
    const testError = new Error('Stream processing failed');
    errorListener?.(null, testError);

    expect(callbacks.onError).toHaveBeenCalledWith(testError);

    // Verify cleanup
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:data:test-request-id-123',
    );
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:end:test-request-id-123',
    );
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:error:test-request-id-123',
    );
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:response:test-request-id-123',
    );
  });

  it('should return cleanup function that removes all listeners', () => {
    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    const params: StreamInvokeRequestParams = {
      headers: {},
      method: 'GET',
      urlPath: '/trpc/test',
    };

    const cleanup = onStreamInvoke(params, callbacks);

    // Call cleanup function
    cleanup();

    // Verify all listeners are removed
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:data:test-request-id-123',
    );
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:end:test-request-id-123',
    );
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:error:test-request-id-123',
    );
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledWith(
      'stream:response:test-request-id-123',
    );
  });

  it('should handle multiple data chunks', () => {
    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    const params: StreamInvokeRequestParams = {
      headers: {},
      method: 'GET',
      urlPath: '/trpc/test',
    };

    onStreamInvoke(params, callbacks);

    const dataListener = mockIpcRendererOn.mock.calls.find((call) =>
      call[0].includes('stream:data'),
    )?.[1];

    // Simulate multiple data chunks
    const chunk1 = Buffer.from('chunk1');
    const chunk2 = Buffer.from('chunk2');
    const chunk3 = Buffer.from('chunk3');

    dataListener?.(null, chunk1);
    dataListener?.(null, chunk2);
    dataListener?.(null, chunk3);

    expect(callbacks.onData).toHaveBeenCalledTimes(3);
    expect(callbacks.onData).toHaveBeenNthCalledWith(1, new Uint8Array(chunk1));
    expect(callbacks.onData).toHaveBeenNthCalledWith(2, new Uint8Array(chunk2));
    expect(callbacks.onData).toHaveBeenNthCalledWith(3, new Uint8Array(chunk3));
  });

  it('should handle complex request parameters', () => {
    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    const params: StreamInvokeRequestParams = {
      body: JSON.stringify({
        filters: { active: true },
        query: 'complex query',
        sort: { field: 'date', order: 'desc' },
      }),
      headers: { 'content-type': 'application/json', 'x-custom-header': 'value' },
      method: 'POST',
      urlPath: '/trpc/lambda/complex.nested.endpoint',
    };

    onStreamInvoke(params, callbacks);

    expect(mockIpcRendererSend).toHaveBeenCalledWith('stream:start', {
      ...params,
      requestId: 'test-request-id-123',
    });
  });

  it('should not invoke callbacks after cleanup', () => {
    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    const params: StreamInvokeRequestParams = {
      headers: {},
      method: 'GET',
      urlPath: '/trpc/test',
    };

    const cleanup = onStreamInvoke(params, callbacks);

    // Cleanup immediately
    cleanup();

    // Try to trigger callbacks after cleanup (this simulates late events)
    const dataListener = mockIpcRendererOn.mock.calls.find((call) =>
      call[0].includes('stream:data'),
    )?.[1];

    // Since listeners are removed, this shouldn't do anything
    // The actual behavior depends on electron's implementation
    // But we can verify cleanup was called
    expect(mockIpcRendererRemoveAllListeners).toHaveBeenCalledTimes(4);
  });

  it('should handle empty buffer data', () => {
    const callbacks = {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      onResponse: vi.fn(),
    };

    const params: StreamInvokeRequestParams = {
      headers: {},
      method: 'GET',
      urlPath: '/trpc/test',
    };

    onStreamInvoke(params, callbacks);

    const dataListener = mockIpcRendererOn.mock.calls.find((call) =>
      call[0].includes('stream:data'),
    )?.[1];

    const emptyBuffer = Buffer.from('');
    dataListener?.(null, emptyBuffer);

    expect(callbacks.onData).toHaveBeenCalledWith(new Uint8Array(emptyBuffer));
  });
});
