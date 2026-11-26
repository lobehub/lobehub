import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { ChatMethodOptions, OnFinishData } from '../../types';
import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

const encoder = new TextEncoder();

/** A stream that ends with the given final data and emits `text` as visible output. */
const createChatResponse = (
  options: ChatMethodOptions | undefined,
  final: OnFinishData,
  text?: string,
) =>
  new Response(
    new ReadableStream({
      async start(controller) {
        if (text) {
          await options?.callback?.onText?.(text);
          controller.enqueue(encoder.encode(text));
        }
        await options?.callback?.onCompletion?.(final);
        await options?.callback?.onFinal?.(final);
        controller.close();
      },
    }),
  );

/** Gemini's billed blank finish: input tokens charged, nothing generated. */
const malformedFinal: OnFinishData = {
  finishReason: 'MALFORMED_RESPONSE',
  text: '',
  usage: { cost: 0.05, totalInputTokens: 1000, totalOutputTokens: 0 },
};

const createRuntimeWith = (
  chatImpl: (call: number, options?: ChatMethodOptions) => Response,
  overrides: Partial<Parameters<typeof createRouterRuntime>[0]> = {},
) => {
  const channels: string[] = [];
  let calls = 0;

  class MockRuntime implements LobeRuntimeAI {
    chat = async (_payload: unknown, options?: ChatMethodOptions) => {
      calls += 1;
      return chatImpl(calls, options);
    };
  }

  const finished = vi.fn(async (result: { channelId?: string }) => {
    channels.push(result.channelId ?? '');
  });
  const Runtime = createRouterRuntime({
    id: 'lobehub',
    onRouteAttemptFinished: finished,
    routers: [
      {
        apiType: 'openai',
        id: 'router-a',
        models: ['gemini'],
        options: [{ id: 'channel-a' }, { id: 'channel-b' }],
        runtime: MockRuntime,
      },
    ],
    // Billed attempts never fall back, matching the Cloud policy.
    shouldFallbackChatAttempt: (result) => (result.usage?.cost ?? 0) === 0,
    shouldRetryChatAttempt: (result, { retryCount }) =>
      result.finishReason === 'MALFORMED_RESPONSE' && retryCount < 2,
    ...overrides,
  });

  return { calls: () => calls, channels, finished, runtime: new Runtime({ userId: 'user-1' }) };
};

describe('RouterRuntime same-option chat retry', () => {
  it('replays a billed blank attempt on the same channel and reports the discarded attempt', async () => {
    const final = vi.fn();
    const onAttemptDiscarded = vi.fn();
    const { calls, channels, runtime } = createRuntimeWith((call, options) =>
      call === 1
        ? createChatResponse(options, malformedFinal)
        : createChatResponse(
            options,
            { finishReason: 'STOP', text: 'answer', usage: { cost: 0.06 } },
            'answer',
          ),
    );

    const response = await runtime.chat(
      { messages: [], model: 'gemini' },
      {
        callback: { onAttemptDiscarded, onFinal: final },
        metadata: { trigger: RequestTrigger.Chat },
      },
    );

    expect(await response.text()).toBe('answer');
    expect(calls()).toBe(2);
    expect(channels).toEqual(['channel-a', 'channel-a']);
    expect(final).toHaveBeenCalledTimes(1);
    expect(final).toHaveBeenCalledWith(expect.objectContaining({ text: 'answer' }));
    expect(onAttemptDiscarded).toHaveBeenCalledTimes(1);
    expect(onAttemptDiscarded).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-a',
        finishReason: 'MALFORMED_RESPONSE',
        outcome: 'empty',
        usage: expect.objectContaining({ cost: 0.05 }),
      }),
    );
  });

  it('stops after the retry budget and commits the last blank attempt', async () => {
    const final = vi.fn();
    const onAttemptDiscarded = vi.fn();
    const { calls, channels, runtime } = createRuntimeWith((_call, options) =>
      createChatResponse(options, malformedFinal),
    );

    const response = await runtime.chat(
      { messages: [], model: 'gemini' },
      {
        callback: { onAttemptDiscarded, onFinal: final },
        metadata: { trigger: RequestTrigger.Chat },
      },
    );

    await expect(response.text()).rejects.toThrow(/empty completion/);
    expect(calls()).toBe(3);
    expect(channels).toEqual(['channel-a', 'channel-a', 'channel-a']);
    expect(onAttemptDiscarded).toHaveBeenCalledTimes(2);
    expect(final).toHaveBeenCalledTimes(1);
    expect(final).toHaveBeenCalledWith(
      expect.objectContaining({
        finishReason: 'MALFORMED_RESPONSE',
        routeAttempt: expect.objectContaining({ outcome: 'empty' }),
      }),
    );
  });

  it('receives the elapsed time and retry count for each decision', async () => {
    const shouldRetryChatAttempt = vi.fn(() => false);
    const { calls, runtime } = createRuntimeWith(
      (_call, options) => createChatResponse(options, malformedFinal),
      { shouldRetryChatAttempt },
    );

    const response = await runtime.chat(
      { messages: [], model: 'gemini' },
      { metadata: { trigger: RequestTrigger.Chat } },
    );

    await expect(response.text()).rejects.toBeDefined();
    expect(calls()).toBe(1);
    expect(shouldRetryChatAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ finishReason: 'MALFORMED_RESPONSE' }),
      { elapsedMs: expect.any(Number), retryCount: 0 },
    );
  });

  it('does not retry an attempt that already streamed visible output', async () => {
    const shouldRetryChatAttempt = vi.fn(() => true);
    const { calls, runtime } = createRuntimeWith(
      (_call, options) =>
        createChatResponse(options, { finishReason: 'STOP', text: 'partial' }, 'partial'),
      { shouldRetryChatAttempt },
    );

    const response = await runtime.chat(
      { messages: [], model: 'gemini' },
      { metadata: { trigger: RequestTrigger.Chat } },
    );

    expect(await response.text()).toBe('partial');
    expect(calls()).toBe(1);
    expect(shouldRetryChatAttempt).not.toHaveBeenCalled();
  });
});
