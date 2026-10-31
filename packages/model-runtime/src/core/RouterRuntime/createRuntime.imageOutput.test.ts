import { AgentRuntimeErrorType, RequestTrigger } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatMethodOptions } from '../../types';
import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

const encoder = new TextEncoder();

const quotaError = {
  body: { message: 'got status: RESOURCE_EXHAUSTED', provider: 'google' },
  message: 'got status: RESOURCE_EXHAUSTED',
  name: 'Stream parsing error',
  type: AgentRuntimeErrorType.QuotaLimitReached,
};

/**
 * Mirrors a Gemini image-output stream: thinking text and an interim thought image arrive
 * long before the final image, and an upstream 429 can end the stream in between.
 */
const createImageModelResponse = (
  options: ChatMethodOptions | undefined,
  config: { ending?: 'error' | 'image' | 'max-tokens'; label: string },
) =>
  new Response(
    new ReadableStream({
      async start(controller) {
        await options?.callback?.onReasoningPart?.({
          content: `${config.label} thinking`,
          partType: 'text',
        });
        controller.enqueue(encoder.encode(`${config.label}:thinking;`));
        await options?.callback?.onReasoningPart?.({
          content: 'AA==',
          mimeType: 'image/png',
          partType: 'image',
        });
        controller.enqueue(encoder.encode(`${config.label}:thought-image;`));

        if (config.ending === 'image') {
          await options?.callback?.onContentPart?.({
            content: 'AA==',
            mimeType: 'image/png',
            partType: 'image',
          });
          controller.enqueue(encoder.encode(`${config.label}:image;`));
          const final = { finishReason: 'STOP', text: '', thinking: `${config.label} thinking` };
          await options?.callback?.onCompletion?.(final);
          await options?.callback?.onFinal?.(final);
        } else if (config.ending === 'max-tokens') {
          const final = {
            finishReason: 'MAX_TOKENS',
            text: '',
            thinking: `${config.label} thinking`,
          };
          await options?.callback?.onCompletion?.(final);
          await options?.callback?.onFinal?.(final);
        } else {
          await options?.callback?.onError?.(quotaError);
          controller.enqueue(encoder.encode(`${config.label}:error;`));
          const final = { error: quotaError, text: '', thinking: `${config.label} thinking` };
          await options?.callback?.onCompletion?.(final);
          await options?.callback?.onFinal?.(final);
        }
        controller.close();
      },
    }),
  );

/** `Response.text()` in happy-dom hides the stream error behind an EncodingError. */
const readStreamError = async (response: Response) => {
  const reader = response.body!.getReader();
  try {
    while (!(await reader.read()).done);
  } catch (error) {
    return error;
  }
};

const createRuntime = (
  isImageOutputModel: (model: string) => boolean | Promise<boolean>,
  firstEnding: 'error' | 'max-tokens' = 'error',
) => {
  let calls = 0;

  class MockRuntime implements LobeRuntimeAI {
    chat = async (_payload: unknown, options?: ChatMethodOptions) => {
      calls += 1;
      return createImageModelResponse(options, {
        ending: calls > 1 ? 'image' : firstEnding,
        label: `attempt-${calls}`,
      });
    };
  }

  const finished = vi.fn();
  const Runtime = createRouterRuntime({
    id: 'lobehub',
    isImageOutputModel,
    onRouteAttemptFinished: finished,
    routers: [
      {
        apiType: 'google',
        id: 'image-router',
        models: ['gemini-nano-banana-2.1'],
        options: [{ id: 'channel-a' }, { id: 'channel-b' }],
        runtime: MockRuntime,
      },
    ],
    shouldFallbackChatAttempt: () => true,
  });

  return { finished, getCalls: () => calls, runtime: new Runtime({ userId: 'user-1' }) };
};

describe('createRouterRuntime image-output stream fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back when an image-output attempt fails after only reasoning was streamed', async () => {
    const isImageOutputModel = vi.fn().mockResolvedValue(true);
    const { finished, getCalls, runtime } = createRuntime(isImageOutputModel);
    const onReasoningPart = vi.fn();
    const onContentPart = vi.fn();
    const onError = vi.fn();

    const response = await runtime.chat(
      { messages: [], model: 'gemini-nano-banana-2.1' },
      {
        callback: { onContentPart, onError, onReasoningPart },
        metadata: { trigger: RequestTrigger.Chat },
      },
    );

    expect(await response.text()).toBe(
      'attempt-2:thinking;attempt-2:thought-image;attempt-2:image;',
    );
    expect(getCalls()).toBe(2);
    expect(isImageOutputModel).toHaveBeenCalledWith('gemini-nano-banana-2.1');
    expect(onReasoningPart.mock.calls.map(([part]) => part.content)).toEqual([
      'attempt-2 thinking',
      'AA==',
    ]);
    expect(onContentPart).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(finished.mock.calls.map(([result]) => result.outcome)).toEqual([
      'interrupted',
      'completed',
    ]);
    // The failed channel keeps the upstream error type so health checks and fallback
    // policy see the 429 instead of a generic partial-output StreamChunkError.
    expect(finished.mock.calls[0][0]).toMatchObject({
      channelId: 'channel-a',
      error: { type: AgentRuntimeErrorType.QuotaLimitReached },
      success: false,
    });
  });

  it('falls back when an image-output attempt ends cleanly with only reasoning', async () => {
    const { finished, getCalls, runtime } = createRuntime(() => true, 'max-tokens');
    const onReasoningPart = vi.fn();

    const response = await runtime.chat(
      { messages: [], model: 'gemini-nano-banana-2.1' },
      { callback: { onReasoningPart }, metadata: { trigger: RequestTrigger.Chat } },
    );

    expect(await response.text()).toBe(
      'attempt-2:thinking;attempt-2:thought-image;attempt-2:image;',
    );
    expect(getCalls()).toBe(2);
    expect(onReasoningPart.mock.calls.map(([part]) => part.content)).toEqual([
      'attempt-2 thinking',
      'AA==',
    ]);
    expect(finished.mock.calls.map(([result]) => result.outcome)).toEqual(['empty', 'completed']);
  });

  it('keeps reasoning committing output for models without image output', async () => {
    const { finished, getCalls, runtime } = createRuntime(() => false);
    const onError = vi.fn();

    const response = await runtime.chat(
      { messages: [], model: 'gemini-nano-banana-2.1' },
      { callback: { onError }, metadata: { trigger: RequestTrigger.Chat } },
    );

    expect(await readStreamError(response)).toMatchObject({ name: 'StreamChunkError' });
    expect(getCalls()).toBe(1);
    expect(onError).toHaveBeenCalledOnce();
    expect(finished.mock.calls.map(([result]) => result.outcome)).toEqual(['interrupted']);
  });

  it('does not fall back when the policy hook rejects the interrupted image attempt', async () => {
    let calls = 0;
    class MockRuntime implements LobeRuntimeAI {
      chat = async (_payload: unknown, options?: ChatMethodOptions) => {
        calls += 1;
        return createImageModelResponse(options, { label: `attempt-${calls}` });
      };
    }
    const shouldFallbackChatAttempt = vi.fn().mockResolvedValue(false);
    const Runtime = createRouterRuntime({
      id: 'lobehub',
      isImageOutputModel: () => true,
      onRouteAttemptFinished: vi.fn(),
      routers: [
        {
          apiType: 'google',
          models: ['gemini-nano-banana-2.1'],
          options: [{ id: 'channel-a' }, { id: 'channel-b' }],
          runtime: MockRuntime,
        },
      ],
      shouldFallbackChatAttempt,
    });

    const response = await new Runtime().chat({ messages: [], model: 'gemini-nano-banana-2.1' });

    expect(await readStreamError(response)).toMatchObject({
      type: AgentRuntimeErrorType.QuotaLimitReached,
    });
    expect(calls).toBe(1);
    expect(shouldFallbackChatAttempt).toHaveBeenCalledOnce();
  });

  it('treats a failing image-output hook as a regular model', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getCalls, runtime } = createRuntime(() => {
      throw new Error('model config unavailable');
    });

    const response = await runtime.chat({ messages: [], model: 'gemini-nano-banana-2.1' });

    expect(await readStreamError(response)).toMatchObject({ name: 'StreamChunkError' });
    expect(getCalls()).toBe(1);
  });
});
