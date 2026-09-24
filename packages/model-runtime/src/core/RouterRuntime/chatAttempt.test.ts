import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatMethodOptions, ChatStreamCallbacks, OnFinishData } from '../../types';
import { observeChatAttempt } from './chatAttempt';

describe('observeChatAttempt', () => {
  afterEach(() => vi.restoreAllMocks());

  const attempt = {
    apiType: 'openai',
    attemptId: 'attempt-1',
    model: 'model',
    optionIndex: 0,
    providerId: 'test',
    requestId: 'request-1',
    startedAt: 1000,
  };

  it('shares completion metrics with final callbacks without including callback work', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const completion = vi.fn((_data: OnFinishData) => {
      now = 5000;
    });
    const final = vi.fn();
    const finished = vi.fn();
    const response = await observeChatAttempt(
      async ({ callback }) => {
        now = 1200;
        await callback?.onText?.('first');
        now = 2200;
        await callback?.onText?.('last');
        now = 2300;
        const data = {
          speed: { duration: 1000, latency: 1300, tps: 100, ttft: 200 },
          text: 'firstlast',
          usage: { cost: 0.001, totalOutputTokens: 100 },
        };
        await callback?.onCompletion?.(data);
        await callback?.onFinal?.(data);
        return new Response('done');
      },
      { callback: { onCompletion: completion, onFinal: final } },
      attempt,
      true,
      finished,
    );
    await response.text();
    expect(completion.mock.calls[0][0]).toEqual(final.mock.calls[0][0]);
    expect(final.mock.calls[0][0]).toMatchObject({
      routeAttempt: { attemptId: 'attempt-1', requestId: 'request-1' },
      speed: { ttft: 200, duration: 1000, latency: 1300, tps: 100 },
    });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(finished.mock.calls[0][0].usage).toMatchObject({
      cost: 0.001,
      totalOutputTokens: 100,
    });
  });

  it('retains reported input usage when the caller cancels before final usage', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const finished = vi.fn();
    const response = await observeChatAttempt(
      async ({ callback }) => {
        await callback?.onUsage?.({
          totalInputTokens: 100,
          inputCachedTokens: 0,
          totalOutputTokens: 5,
        });
        await callback?.onThinking?.('reason');
        now = 2000;
        await callback?.onText?.('partial answer');
        return new Response(new ReadableStream());
      },
      undefined,
      attempt,
      true,
      finished,
    );
    await response.body!.cancel();
    expect(finished.mock.calls[0][0]).toMatchObject({
      outcome: 'cancelled',
      usage: { totalInputTokens: 100, inputCachedTokens: 0 },
    });
    expect(finished.mock.calls[0][0].usage.totalOutputTokens).toBe(5);
    expect(finished.mock.calls[0][0].speed).toBeUndefined();
  });

  it('leaves buffered response speed unknown and isolates observer failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const finished = vi.fn().mockRejectedValue(new Error('observer unavailable'));
    const response = await observeChatAttempt(
      async ({ callback }) => {
        await callback?.onText?.('answer');
        await callback?.onFinal?.({ text: 'answer', usage: { totalOutputTokens: 20 } });
        return new Response('answer');
      },
      undefined,
      attempt,
      false,
      finished,
    );
    expect(await response.text()).toBe('answer');
    expect(finished.mock.calls[0][0].speed).toBeUndefined();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('does not block response completion on a pending observer', async () => {
    let releaseObserver!: () => void;
    const finished = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseObserver = resolve;
        }),
    );
    const response = await observeChatAttempt(
      async ({ callback }) => {
        await callback?.onText?.('answer');
        await callback?.onFinal?.({ text: 'answer' });
        return new Response('answer');
      },
      undefined,
      attempt,
      true,
      finished,
    );
    const responseText = response.text();

    const outcome = await Promise.race([
      responseText.then(() => 'completed'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 50)),
    ]);
    releaseObserver();

    expect(outcome).toBe('completed');
    await expect(responseText).resolves.toBe('answer');
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'content text',
      async (callback?: ChatStreamCallbacks) => {
        await callback?.onContentPart?.({ content: 'answer', partType: 'text' });
      },
    ],
    [
      'reasoning text',
      async (callback?: ChatStreamCallbacks) => {
        await callback?.onReasoningPart?.({ content: 'reason', partType: 'text' });
      },
    ],
    [
      'structured image',
      async (callback?: ChatStreamCallbacks) => {
        await callback?.onContentPart?.({
          content: 'base64-image',
          mimeType: 'image/png',
          partType: 'image',
        });
      },
    ],
  ] as const)('counts %s as a non-empty completion', async (_label, emitPart) => {
    const finished = vi.fn();
    const response = await observeChatAttempt(
      async ({ callback }) => {
        await emitPart(callback);
        await callback?.onFinal?.({ text: '' });
        return new Response('');
      },
      undefined,
      attempt,
      true,
      finished,
    );

    expect(await response.text()).toBe('');
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'completed' }));
  });

  it('adds attempt identity without replacing provider performance', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const finished = vi.fn();
    const final = vi.fn();
    const response = await observeChatAttempt(
      async (options) => {
        now = 1800;
        await options.callback?.onFinal?.({
          speed: { duration: 200, latency: 800, ttft: 300 },
          text: 'answer',
        });
        return new Response('done');
      },
      { callback: { onFinal: final } },
      attempt,
      true,
      finished,
    );
    await response.text();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(finished.mock.calls[0][0]).toMatchObject({
      ...attempt,
      outcome: 'completed',
      speed: { ttft: 300, duration: 200, latency: 800 },
    });
    expect(finished.mock.calls[0][0].speed.tps).toBeUndefined();
    expect(final.mock.calls[0][0].routeAttempt).toEqual({
      attemptId: 'attempt-1',
      outcome: 'completed',
      requestId: 'request-1',
    });
  });

  it.each(['error', 'cancel'] as const)(
    'records a body %s even when onFinal never runs',
    async (mode) => {
      const finished = vi.fn();
      const cancel = vi.fn();
      const response = await observeChatAttempt(
        async () =>
          new Response(
            new ReadableStream({
              cancel,
              pull(controller) {
                if (mode === 'error') controller.error(new Error('disconnected'));
              },
            }),
          ),
        undefined,
        attempt,
        true,
        finished,
      );
      if (mode === 'error') await expect(response.text()).rejects.toThrow('disconnected');
      else await response.body!.cancel();
      expect(finished).toHaveBeenCalledTimes(1);
      expect(finished.mock.calls[0][0].outcome).toBe(
        mode === 'error' ? 'interrupted' : 'cancelled',
      );
      if (mode === 'cancel') expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('synthesizes one final callback when the response body fails before provider final', async () => {
    const upstreamError = new Error('disconnected');
    const final = vi.fn();
    const response = await observeChatAttempt(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(upstreamError);
            },
          }),
        ),
      { callback: { onFinal: final } },
      attempt,
      true,
      vi.fn(),
    );

    await expect(response.text()).rejects.toThrow('disconnected');
    expect(final).toHaveBeenCalledTimes(1);
    expect(final).toHaveBeenCalledWith(
      expect.objectContaining({
        error: upstreamError,
        routeAttempt: expect.objectContaining({ outcome: 'interrupted' }),
        text: '',
      }),
    );
  });

  it('does not turn an error event or abort into a successful completion', async () => {
    for (const data of [
      { error: { message: 'failed' }, text: '' },
      { finishReason: 'abort', text: '' },
    ]) {
      const finished = vi.fn();
      const response = await observeChatAttempt(
        async ({ callback }) => {
          await callback?.onFinal?.(data);
          return new Response('done');
        },
        undefined,
        attempt,
        true,
        finished,
      );
      await response.text();
      expect(finished.mock.calls[0][0].outcome).toBe(data.error ? 'interrupted' : 'cancelled');
    }
  });

  it.each([
    { expectedOutcome: 'completed', text: 'I cannot help with that.' },
    { expectedOutcome: 'empty', text: '' },
  ])(
    'reports the provider finish reason on a $expectedOutcome attempt',
    async ({ expectedOutcome, text }) => {
      const finished = vi.fn();
      const response = await observeChatAttempt(
        async ({ callback }) => {
          if (text) await callback?.onText?.(text);
          await callback?.onFinal?.({ finishReason: 'refusal', text });
          return new Response('done');
        },
        undefined,
        attempt,
        true,
        finished,
      );
      await response.text().catch(() => {});

      expect(finished).toHaveBeenCalledTimes(1);
      expect(finished.mock.calls[0][0]).toMatchObject({
        finishReason: 'refusal',
        outcome: expectedOutcome,
      });
    },
  );

  it('keeps concurrent attempt identities isolated even with shared options', async () => {
    const finals: OnFinishData[] = [];
    const options: ChatMethodOptions = {
      callback: {
        onFinal: (data) => {
          finals.push(data);
        },
      },
    };
    const finished = vi.fn();
    await Promise.all(
      ['a', 'b'].map((attemptId) =>
        observeChatAttempt(
          async ({ callback }) => {
            await callback?.onFinal?.({ text: attemptId });
            return new Response('done');
          },
          options,
          { ...attempt, attemptId },
          true,
          finished,
        ).then((response) => response.text()),
      ),
    );
    expect(finals.map((data) => data.routeAttempt?.attemptId)).toEqual(['a', 'b']);
    expect(options.metadata).toBeUndefined();
  });
});
