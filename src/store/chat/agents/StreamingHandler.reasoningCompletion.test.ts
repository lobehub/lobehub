import { fetchSSE } from '@lobechat/fetch-sse';
import { fetchEventSource } from '@lobechat/utils/client/fetchEventSource/index';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamingHandler } from './StreamingHandler';
import type { StreamChunk, StreamingCallbacks } from './types/streaming';

vi.mock('@lobechat/utils/client/fetchEventSource/index', () => ({ fetchEventSource: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  const callbacks: StreamingCallbacks = {
    onContentUpdate: vi.fn(),
    onReasoningUpdate: vi.fn(),
    onToolCallsUpdate: vi.fn(),
    onGroundingUpdate: vi.fn(),
    onImagesUpdate: vi.fn(),
    onReasoningStart: vi.fn(() => 'reasoning-operation'),
    onReasoningComplete: vi.fn(),
    uploadBase64Image: vi.fn(async () => ({ id: 'unused', url: 'https://example.com/unused' })),
    transformToolCalls: vi.fn(() => []),
    toggleToolCallingStreaming: vi.fn(),
  };
  const handler = new StreamingHandler(
    { messageId: 'message', operationId: 'operation', agentId: 'agent' },
    callbacks,
  );
  return { callbacks, handler };
}

describe('reasoning completion after client buffers are flushed', () => {
  it.each(['fadeIn', 'smooth', 'none'] as const)(
    'closes reasoning delivered after stop events (%s)',
    async (responseAnimation) => {
      const { callbacks, handler } = setup();
      const events: string[] = [];
      // Deliver all provider events before the animation and buffer timers run.
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
      vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
      vi.mocked(fetchEventSource).mockImplementationOnce(async (_url, options) => {
        await options.onopen?.(
          new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
        );
        for (const [event, data] of [
          ['reasoning', 'Provider thinking content'],
          ['text', 'Completed provider answer'],
          ['stop', 'end_turn'],
          ['stop', 'message_stop'],
        ] as const) {
          options.onmessage?.({ data: JSON.stringify(data), event, id: 'provider-message' });
        }
      });
      await fetchSSE('/chat', {
        responseAnimation,
        onMessageHandle: (chunk) => {
          events.push(chunk.type);
          handler.handleChunk(chunk as StreamChunk);
        },
        onFinish: async (_answer, data) => {
          events.push('finish');
          await handler.handleFinish(data);
        },
      });
      expect(events.indexOf('reasoning')).toBeGreaterThan(events.lastIndexOf('stop'));
      expect(handler.getOutput()).toBe('Completed provider answer');
      expect(handler.getThinkingContent()).toBe('Provider thinking content');
      expect(callbacks.onReasoningStart).toHaveBeenCalledTimes(1);
      expect(callbacks.onReasoningComplete).toHaveBeenCalledExactlyOnceWith('reasoning-operation');
    },
  );

  it('preserves a normal streamed reasoning completion', async () => {
    const { callbacks, handler } = setup();
    handler.handleChunk({ type: 'reasoning', text: 'Thinking' });
    handler.handleChunk({ type: 'text', text: 'Answer' });
    handler.handleChunk({ type: 'stop' });
    await handler.handleFinish({ type: 'done' });
    expect(callbacks.onReasoningComplete).toHaveBeenCalledExactlyOnceWith('reasoning-operation');
  });

  it('does not create a reasoning operation for text-only output', async () => {
    const { callbacks, handler } = setup();
    handler.handleChunk({ type: 'text', text: 'Answer' });
    handler.handleChunk({ type: 'stop' });
    await handler.handleFinish({ type: 'done' });
    expect(callbacks.onReasoningStart).not.toHaveBeenCalled();
    expect(callbacks.onReasoningComplete).not.toHaveBeenCalled();
  });

  it.each(['done', 'error', 'abort'] as const)(
    'closes unfinished reasoning at terminal finish (%s)',
    async (type) => {
      const { callbacks, handler } = setup();
      handler.handleChunk({ type: 'reasoning', text: 'Preserved reasoning' });
      const result = await handler.handleFinish({
        type,
        reasoning: { signature: 'original-signature' },
      });
      expect(callbacks.onReasoningComplete).toHaveBeenCalledExactlyOnceWith('reasoning-operation');
      expect(result.finishType).toBe(type);
      expect(result.metadata.reasoning).toMatchObject({
        content: 'Preserved reasoning',
        signature: 'original-signature',
      });
    },
  );

  it('preserves an already completed zero-ms duration when finish is repeated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    const { callbacks, handler } = setup();
    handler.handleChunk({ type: 'reasoning', text: 'Thinking' });
    handler.handleChunk({ type: 'text', text: 'Answer' });
    expect(handler.getThinkingDuration()).toBe(0);
    vi.advanceTimersByTime(1000);
    await handler.handleFinish({ type: 'done' });
    vi.advanceTimersByTime(1000);
    await handler.handleFinish({ type: 'done' });
    expect(handler.getThinkingDuration()).toBe(0);
    expect(callbacks.onReasoningStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onReasoningComplete).toHaveBeenCalledExactlyOnceWith('reasoning-operation');
  });
});
