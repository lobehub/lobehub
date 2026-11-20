import type { ModelUsage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CreateImagePayload,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { readRouteAttemptIdentity } from '../../types';
import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

const usage: ModelUsage = { cost: 0.001, totalInputTokens: 10, totalOutputTokens: 5 };

/** Channel `channel-a` fails after reporting usage; `channel-b` serves the request. */
const createFallbackRuntime = (method: 'embeddings' | 'generateObject') => {
  const calls = { count: 0 };
  class MockRuntime implements LobeRuntimeAI {
    async embeddings(_payload: EmbeddingsPayload, options?: EmbeddingsOptions) {
      return this.respond(options, [[0.1]]);
    }

    async generateObject(_payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      return this.respond(options, { ok: true });
    }

    private async respond<T>(
      options: { onUsage?: EmbeddingsOptions['onUsage'] } | undefined,
      result: T,
    ) {
      calls.count += 1;
      await options?.onUsage?.(usage);
      if (calls.count === 1) throw new Error('first channel failed');
      return result;
    }
  }

  const Runtime = createRouterRuntime({
    id: 'lobehub',
    routers: [
      {
        apiType: 'openai',
        id: 'router-1',
        models: ['model-x'],
        options: [{ id: 'channel-a' }, { id: 'channel-b' }],
        runtime: MockRuntime as any,
      },
    ],
  });

  return { method, runtime: new Runtime({ userId: 'user-1' }) };
};

describe('createRouterRuntime usage attribution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['generateObject', 'embeddings'] as const)(
    'tags %s usage with the identity of the attempt that reported it',
    async (method) => {
      const { runtime } = createFallbackRuntime(method);
      const onUsage = vi.fn();
      const metadata: Record<string, unknown> = { traceId: 'trace-1', trigger: 'chat' };
      const options = { metadata, onUsage };

      if (method === 'generateObject') {
        await runtime.generateObject({ messages: [], model: 'model-x' }, options);
      } else {
        await runtime.embeddings({ input: 'hi', model: 'model-x' }, options);
      }

      expect(onUsage).toHaveBeenCalledTimes(2);
      const [first, second] = onUsage.mock.calls.map(([, context]) => context.routeAttempt);
      expect(first).toMatchObject({ channelId: 'channel-a', routerId: 'router-1' });
      expect(second).toMatchObject({ channelId: 'channel-b', routerId: 'router-1' });
      expect(first.attemptId).not.toBe(second.attemptId);
      // Both attempts belong to one request.
      expect(first.requestId).toBe(second.requestId);
      // The metadata identity points at the attempt that served the request.
      expect(readRouteAttemptIdentity(metadata)).toEqual(second);
    },
  );

  it('exposes the serving attempt identity to callers billing after createImage returns', async () => {
    class MockRuntime implements LobeRuntimeAI {
      createImage = vi.fn(async (_payload: CreateImagePayload) => ({ imageUrl: 'https://img' }));
    }
    const Runtime = createRouterRuntime({
      id: 'lobehub',
      routers: [
        {
          apiType: 'openai',
          id: 'router-1',
          models: ['image-x'],
          options: { id: 'channel-1' },
          runtime: MockRuntime as any,
        },
      ],
    });
    const metadata: Record<string, unknown> = { traceId: 'trace-1', trigger: 'image' };

    await new Runtime({ userId: 'user-1' }).createImage(
      { model: 'image-x', params: { prompt: 'cat' } as any },
      { metadata },
    );

    expect(readRouteAttemptIdentity(metadata)).toEqual({
      attemptId: expect.any(String),
      channelId: 'channel-1',
      requestId: expect.any(String),
      routerId: 'router-1',
    });
  });
});

describe('readRouteAttemptIdentity', () => {
  it('ignores metadata without a complete identity', () => {
    expect(readRouteAttemptIdentity(undefined)).toBeUndefined();
    expect(readRouteAttemptIdentity({ routeAttempt: { channelId: 'c' } })).toBeUndefined();
    expect(
      readRouteAttemptIdentity({ routeAttempt: { attemptId: 'a', channelId: 1, requestId: 'r' } }),
    ).toEqual({ attemptId: 'a', requestId: 'r' });
  });
});
