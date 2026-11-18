import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

const createAbortError = () =>
  Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });

/** Every channel rejects with an abort error, as an SDK does once the request signal fires. */
const createCancelledRuntime = () => {
  const servedBy: string[] = [];
  class MockRuntime implements LobeRuntimeAI {
    constructor(private readonly options: { channel: string }) {}

    async embeddings(
      _payload: EmbeddingsPayload,
      _options?: EmbeddingsOptions,
    ): Promise<number[][]> {
      servedBy.push(this.options.channel);
      throw createAbortError();
    }

    async generateObject(_payload: GenerateObjectPayload, _options?: GenerateObjectOptions) {
      servedBy.push(this.options.channel);
      throw createAbortError();
    }
  }

  const onRouteAttempt = vi.fn(async () => {});
  const Runtime = createRouterRuntime({
    id: 'test-router',
    onRouteAttempt,
    routers: [
      {
        apiType: 'openai',
        models: ['model-x'],
        options: [
          { channel: 'channel-a', id: 'channel-a' },
          { channel: 'channel-b', id: 'channel-b' },
        ],
        runtime: MockRuntime as any,
      },
    ],
  });

  return { onRouteAttempt, runtime: new Runtime({ apiKey: 'test' }), servedBy };
};

describe('createRouterRuntime cancelled requests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      'generateObject',
      (runtime: any, signal: AbortSignal) =>
        runtime.generateObject({ messages: [], model: 'model-x', schema: {} }, { signal }),
    ],
    [
      'embeddings',
      (runtime: any, signal: AbortSignal) =>
        runtime.embeddings({ input: 'hi', model: 'model-x' }, { signal }),
    ],
  ])('does not try another channel once %s is cancelled', async (_method, call) => {
    const { onRouteAttempt, runtime, servedBy } = createCancelledRuntime();
    const controller = new AbortController();
    controller.abort();

    await expect(call(runtime, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    expect(servedBy).toEqual(['channel-a']);
    expect(onRouteAttempt).toHaveBeenCalledTimes(1);
  });
});
