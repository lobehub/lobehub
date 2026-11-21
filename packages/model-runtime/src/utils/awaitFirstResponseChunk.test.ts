import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { LobeRuntimeAI } from '../core/BaseAI';
import { createRouterRuntime } from '../core/RouterRuntime/createRuntime';
import type { ChatMethodOptions } from '../types';
import { awaitFirstResponseChunk } from './awaitFirstResponseChunk';

const encode = (text: string) => new TextEncoder().encode(text);

describe('awaitFirstResponseChunk', () => {
  it('replays the first chunk and the rest of the body with the original status and headers', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encode('a'));
          controller.enqueue(encode('b'));
          controller.close();
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' }, status: 201 },
    );

    const primed = await awaitFirstResponseChunk(response);

    expect(primed.status).toBe(201);
    expect(primed.headers.get('content-type')).toBe('text/event-stream');
    expect(await primed.text()).toBe('ab');
  });

  it('rejects when the body fails before yielding any chunk', async () => {
    const error = new Error('empty');
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(error);
        },
      }),
    );

    await expect(awaitFirstResponseChunk(response)).rejects.toBe(error);
  });

  it('keeps a failure after the first chunk inside the body', async () => {
    const error = new Error('late');
    let pulls = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(encode('a'));
          else controller.error(error);
        },
      }),
    );

    const reader = (await awaitFirstResponseChunk(response)).body!.getReader();

    expect((await reader.read()).value).toEqual(encode('a'));
    await expect(reader.read()).rejects.toBe(error);
  });

  it('passes through an empty body and a response without a body', async () => {
    expect(await (await awaitFirstResponseChunk(new Response(''))).text()).toBe('');

    const bodiless = new Response(null, { status: 204 });
    expect(await awaitFirstResponseChunk(bodiless)).toBe(bodiless);
  });

  it('forwards cancellation to the source body', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel,
        pull(controller) {
          controller.enqueue(encode('a'));
        },
      }),
    );

    const primed = await awaitFirstResponseChunk(response);
    await primed.body!.cancel('client gone');

    expect(cancel).toHaveBeenCalledWith('client gone');
  });

  it('rejects with the empty-completion error when every route returns an empty completion', async () => {
    class EmptyRuntime implements LobeRuntimeAI {
      chat = async (_payload: unknown, options?: ChatMethodOptions) =>
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              const final = { finishReason: 'MAX_TOKENS', text: '', usage: { cost: 0.001 } };
              await options?.callback?.onCompletion?.(final);
              await options?.callback?.onFinal?.(final);
              controller.enqueue(encode('event: stop\ndata: "MAX_TOKENS"\n\n'));
              controller.close();
            },
          }),
        );
    }
    const Runtime = createRouterRuntime({
      id: 'test-runtime',
      onRouteAttemptFinished: vi.fn(),
      routers: [{ apiType: 'openai', models: ['gpt-4'], options: [{}, {}], runtime: EmptyRuntime }],
      shouldFallbackChatAttempt: () => true,
    });

    const response = await new Runtime().chat({ messages: [], model: 'gpt-4' } as any);

    await expect(awaitFirstResponseChunk(response)).rejects.toMatchObject({
      diagnostics: expect.objectContaining({ finishReason: 'MAX_TOKENS' }),
      errorType: AgentRuntimeErrorType.ModelEmptyCompletion,
    });
  });
});
