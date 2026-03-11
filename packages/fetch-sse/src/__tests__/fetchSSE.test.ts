import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import type { ChatMessageError } from '@lobechat/types';
import type { FetchEventSourceInit } from '@lobechat/utils/client/fetchEventSource/index';
import { fetchEventSource } from '@lobechat/utils/client/fetchEventSource/index';
import { sleep } from '@lobechat/utils/sleep';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSSE } from '../fetchSSE';

// 模拟 i18next
vi.mock('i18next', () => ({
  t: vi.fn((key) => `translated_${key}`),
}));

vi.mock('@lobechat/utils/client/fetchEventSource/index', () => ({
  fetchEventSource: vi.fn(),
}));

// 在每次测试后清理所有模拟
afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSSE', () => {
  it('should handle text event correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify(' World') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'fadeIn',
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, { text: 'Hello World', type: 'text' });
    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('should handle tool_calls event correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([
            { index: 0, id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
          ]),
        } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([
            { index: 1, id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
          ]),
        } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'fadeIn',
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, {
      tool_calls: [{ id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } }],
      type: 'tool_calls',
    });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(2, {
      tool_calls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
      ],
      type: 'tool_calls',
    });
    expect(mockOnFinish).toHaveBeenCalledWith('', {
      observationId: null,
      toolCalls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
      ],
      traceId: null,
      type: 'done',
    });
  });

  it('should call onMessageHandle with full text if no message event', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        const res = new Response('Hello World', { status: 200, statusText: 'OK' });
        options.onopen!(res as any);
      },
    );

    await fetchSSE('/', { onMessageHandle: mockOnMessageHandle, onFinish: mockOnFinish });

    expect(mockOnMessageHandle).toHaveBeenCalledWith({ text: 'Hello World', type: 'text' });
    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('should handle text event with smoothing correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      async (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        await sleep(100);
        options.onmessage!({ event: 'text', data: JSON.stringify(' World') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'smooth',
    });

    const expectedMessages = [
      { text: 'H', type: 'text' },
      { text: 'e', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'o', type: 'text' },
      { text: ' ', type: 'text' },
      { text: 'W', type: 'text' },
      { text: 'o', type: 'text' },
      { text: 'r', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'd', type: 'text' },
    ];

    expectedMessages.forEach((message, index) => {
      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(index + 1, message);
    });

    // more assertions for each character...
    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('should not handle text events', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      async (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('He') } as any);
        await sleep(100);
        options.onmessage!({ event: 'text', data: JSON.stringify('llo') } as any);
        await sleep(60);
        options.onmessage!({ event: 'text', data: JSON.stringify(' World') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'none',
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, { text: 'He', type: 'text' });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(2, { text: 'llo', type: 'text' });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(3, { text: ' World', type: 'text' });

    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  describe('reasoning', () => {
    it('should handle reasoning event without smoothing', async () => {
      const mockOnMessageHandle = vi.fn();
      const mockOnFinish = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        async (url: string, options: FetchEventSourceInit) => {
          options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
          options.onmessage!({ event: 'reasoning', data: JSON.stringify('Hello') } as any);
          await sleep(400);
          options.onmessage!({ event: 'reasoning', data: JSON.stringify(' World') } as any);
          await sleep(400);
          options.onmessage!({ event: 'text', data: JSON.stringify('hi') } as any);
        },
      );

      await fetchSSE('/', {
        onMessageHandle: mockOnMessageHandle,
        onFinish: mockOnFinish,
        responseAnimation: 'fadeIn',
      });

      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, { text: 'Hello', type: 'reasoning' });
      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(2, { text: ' World', type: 'reasoning' });

      expect(mockOnFinish).toHaveBeenCalledWith('hi', {
        observationId: null,
        toolCalls: undefined,
        reasoning: { content: 'Hello World' },
        traceId: null,
        type: 'done',
      });
    });
  });

  describe('content_part and reasoning_part', () => {
    it('should handle content_part event with text and accumulate output', async () => {
      const mockOnMessageHandle = vi.fn();
      const mockOnFinish = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        async (url: string, options: FetchEventSourceInit) => {
          options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
          options.onmessage!({
            event: 'content_part',
            data: JSON.stringify({ content: 'Hello', partType: 'text' }),
          } as any);
          options.onmessage!({
            event: 'content_part',
            data: JSON.stringify({ content: ' World', partType: 'text' }),
          } as any);
        },
      );

      await fetchSSE('/', {
        onMessageHandle: mockOnMessageHandle,
        onFinish: mockOnFinish,
        responseAnimation: 'none',
      });

      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, {
        content: 'Hello',
        mimeType: undefined,
        partType: 'text',
        thoughtSignature: undefined,
        type: 'content_part',
      });
      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(2, {
        content: ' World',
        mimeType: undefined,
        partType: 'text',
        thoughtSignature: undefined,
        type: 'content_part',
      });

      // Verify output is accumulated correctly
      expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
        observationId: null,
        toolCalls: undefined,
        traceId: null,
        type: 'done',
      });
    });

    it('should handle reasoning_part event with text and accumulate thinking', async () => {
      const mockOnMessageHandle = vi.fn();
      const mockOnFinish = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        async (url: string, options: FetchEventSourceInit) => {
          options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
          options.onmessage!({
            event: 'reasoning_part',
            data: JSON.stringify({ content: 'Thinking:', partType: 'text' }),
          } as any);
          options.onmessage!({
            event: 'reasoning_part',
            data: JSON.stringify({ content: ' step 1', partType: 'text' }),
          } as any);
          options.onmessage!({
            event: 'content_part',
            data: JSON.stringify({ content: 'Final answer', partType: 'text' }),
          } as any);
        },
      );

      await fetchSSE('/', {
        onMessageHandle: mockOnMessageHandle,
        onFinish: mockOnFinish,
        responseAnimation: 'none',
      });

      // Verify reasoning is accumulated correctly
      expect(mockOnFinish).toHaveBeenCalledWith('Final answer', {
        observationId: null,
        reasoning: { content: 'Thinking: step 1' },
        toolCalls: undefined,
        traceId: null,
        type: 'done',
      });
    });

    it('should not accumulate output for non-text content_part (e.g., image)', async () => {
      const mockOnMessageHandle = vi.fn();
      const mockOnFinish = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        async (url: string, options: FetchEventSourceInit) => {
          options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
          options.onmessage!({
            event: 'content_part',
            data: JSON.stringify({
              content: 'base64imagedata',
              partType: 'image',
              mimeType: 'image/png',
            }),
          } as any);
        },
      );

      await fetchSSE('/', {
        onMessageHandle: mockOnMessageHandle,
        onFinish: mockOnFinish,
        responseAnimation: 'none',
      });

      expect(mockOnMessageHandle).toHaveBeenCalledWith({
        content: 'base64imagedata',
        mimeType: 'image/png',
        partType: 'image',
        thoughtSignature: undefined,
        type: 'content_part',
      });

      // Output should be empty since image content is not accumulated
      expect(mockOnFinish).toHaveBeenCalledWith('', {
        observationId: null,
        toolCalls: undefined,
        traceId: null,
        type: 'done',
      });
    });
  });

  it('should handle grounding event', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      async (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'grounding', data: JSON.stringify('Hello') } as any);
        await sleep(100);
        options.onmessage!({ event: 'text', data: JSON.stringify('hi') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, {
      grounding: 'Hello',
      type: 'grounding',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('hi', {
      observationId: null,
      toolCalls: undefined,
      grounding: 'Hello',
      traceId: null,
      type: 'done',
    });
  });

  it('should handle tool_calls event correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([
            { index: 0, id: '1', type: 'function', function: { name: 'func1', arguments: 'a' } },
          ]),
        } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([
            { index: 0, function: { arguments: 'rg1' } },
            { index: 1, id: '2', type: 'function', function: { name: 'func2', arguments: 'a' } },
          ]),
        } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([{ index: 1, function: { arguments: 'rg2' } }]),
        } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'smooth',
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, {
      tool_calls: [{ id: '1', type: 'function', function: { name: 'func1', arguments: 'a' } }],
      type: 'tool_calls',
    });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(2, {
      tool_calls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'a' } },
      ],
      type: 'tool_calls',
    });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(3, {
      tool_calls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
      ],
      type: 'tool_calls',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('', {
      observationId: null,
      toolCalls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
      ],
      traceId: null,
      type: 'done',
    });
  });

  it('should handle request interruption and resumption correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();
    const abortController = new AbortController();

    (fetchEventSource as any).mockImplementationOnce(
      async (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        await sleep(100);
        abortController.abort();
        options.onmessage!({ event: 'text', data: JSON.stringify(' World') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      signal: abortController.signal,
      responseAnimation: 'smooth',
    });

    const expectedMessages = [
      { text: 'H', type: 'text' },
      { text: 'e', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'o', type: 'text' },
      { text: ' ', type: 'text' },
      { text: 'W', type: 'text' },
      { text: 'o', type: 'text' },
      { text: 'r', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'd', type: 'text' },
    ];

    expectedMessages.forEach((message, index) => {
      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(index + 1, message);
    });

    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      type: 'done',
      observationId: null,
      traceId: null,
    });
  });

  it('should call onFinish with correct parameters for different finish types', async () => {
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        options.onerror!({ name: 'AbortError' });
      },
    );

    await fetchSSE('/', { onFinish: mockOnFinish, responseAnimation: 'fadeIn' });

    expect(mockOnFinish).toHaveBeenCalledWith('Hello', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'abort',
    });

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        options.onerror!(new Error('Unknown error'));
      },
    );

    await fetchSSE('/', { onFinish: mockOnFinish, responseAnimation: 'fadeIn' });

    expect(mockOnFinish).toHaveBeenCalledWith('Hello', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'error',
    });
  });

  describe('onAbort', () => {
    it('should call onAbort when AbortError is thrown', async () => {
      const mockOnAbort = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
          options.onerror!({ name: 'AbortError' });
        },
      );

      await fetchSSE('/', { onAbort: mockOnAbort, responseAnimation: 'fadeIn' });

      expect(mockOnAbort).toHaveBeenCalledWith('Hello');
    });

    it('should call onAbort when MESSAGE_CANCEL_FLAT is thrown', async () => {
      const mockOnAbort = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
          options.onerror!(MESSAGE_CANCEL_FLAT);
        },
      );

      await fetchSSE('/', { onAbort: mockOnAbort, responseAnimation: 'fadeIn' });

      expect(mockOnAbort).toHaveBeenCalledWith('Hello');
    });
  });

  describe('onErrorHandle', () => {
    it('should call onErrorHandle when Chat Message error is thrown', async () => {
      const mockOnErrorHandle = vi.fn();
      const mockError: ChatMessageError = {
        body: {},
        message: 'StreamChunkError',
        type: 'StreamChunkError',
      };

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onerror!(mockError);
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {}

      expect(mockOnErrorHandle).toHaveBeenCalledWith(mockError);
    });

    it('should call onErrorHandle when Unknown error is thrown', async () => {
      const mockOnErrorHandle = vi.fn();
      const mockError = new Error('Unknown error');

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onerror!(mockError);
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {}

      expect(mockOnErrorHandle).toHaveBeenCalledWith({
        type: 'UnknownChatFetchError',
        message: 'Unknown error',
        body: {
          message: 'Unknown error',
          name: 'Error',
          stack: expect.any(String),
        },
      });
    });

    it('should call onErrorHandle when response is not ok', async () => {
      const mockOnErrorHandle = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        async (url: string, options: FetchEventSourceInit) => {
          const res = new Response(JSON.stringify({ errorType: 'SomeError' }), {
            status: 400,
            statusText: 'Error',
          });

          try {
            await options.onopen!(res as any);
          } catch (e) {}
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {
        expect(mockOnErrorHandle).toHaveBeenCalledWith({
          body: undefined,
          message: 'translated_response.SomeError',
          type: 'SomeError',
        });
      }
    });

    it('should call onErrorHandle when stream chunk has error type', async () => {
      const mockOnErrorHandle = vi.fn();
      const mockError = {
        type: 'StreamChunkError',
        message: 'abc',
        body: { message: 'abc', context: {} },
      };

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({
            event: 'error',
            data: JSON.stringify(mockError),
          } as any);
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {}

      expect(mockOnErrorHandle).toHaveBeenCalledWith(mockError);
    });

    it('should call onErrorHandle when stream chunk is not valid json', async () => {
      const mockOnErrorHandle = vi.fn();
      const mockError = 'abc';

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'text', data: mockError } as any);
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {}

      expect(mockOnErrorHandle).toHaveBeenCalledWith({
        body: {
          context: {
            chunk: 'abc',
            error: {
              message: 'Unexpected token \'a\', "abc" is not valid JSON',
              name: 'SyntaxError',
            },
          },
          message:
            'chat response streaming chunk parse error, please contact your API Provider to fix it.',
        },
        message: 'parse error',
        type: 'StreamChunkError',
      });
    });
  });
});
