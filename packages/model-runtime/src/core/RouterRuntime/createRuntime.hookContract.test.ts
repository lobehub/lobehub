import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

/**
 * Cloud health handling runs from `onRouteAttempt` only when `completionPending` is
 * absent, so non-chat methods must report each attempt exactly once without it.
 */
const createRuntime = (failingChannels: string[]) => {
  class MockRuntime implements LobeRuntimeAI {
    constructor(private readonly options: { channel: string }) {}

    async generateObject(_payload: GenerateObjectPayload, _options?: GenerateObjectOptions) {
      if (failingChannels.includes(this.options.channel)) throw new Error('channel failed');
      return { servedBy: this.options.channel };
    }
  }

  const hooks = {
    onRouteAttempt: vi.fn(async () => {}),
    onRouteSuccess: vi.fn(async () => {}),
    scheduleRouteRequestSettled: vi.fn(),
  };
  const Runtime = createRouterRuntime({
    id: 'test-router',
    ...hooks,
    routers: [
      {
        apiType: 'openai',
        id: 'router-1',
        models: ['model-x'],
        options: [
          { channel: 'channel-a', id: 'channel-a' },
          { channel: 'channel-b', id: 'channel-b' },
        ],
        runtime: MockRuntime as any,
      },
    ],
  });

  return { hooks, runtime: new Runtime({ apiKey: 'test' }) };
};

const generate = (runtime: any) =>
  runtime.generateObject({ messages: [], model: 'model-x', schema: {} });

describe('createRouterRuntime non-chat hook contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports one committed attempt and one route success', async () => {
    const { hooks, runtime } = createRuntime([]);

    await expect(generate(runtime)).resolves.toEqual({ servedBy: 'channel-a' });

    expect(hooks.onRouteAttempt).toHaveBeenCalledTimes(1);
    const [attempt] = hooks.onRouteAttempt.mock.calls[0] as any[];
    expect(attempt).toMatchObject({ channelId: 'channel-a', optionIndex: 0, success: true });
    expect(attempt).not.toHaveProperty('completionPending');
    expect(attempt).not.toHaveProperty('routeRequestManaged');

    expect(hooks.onRouteSuccess).toHaveBeenCalledTimes(1);
    expect(hooks.onRouteSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'channel-a', method: 'generateObject' }),
    );
    expect(hooks.scheduleRouteRequestSettled).not.toHaveBeenCalled();
  });

  it('reports each fallback attempt once with a shared request and distinct attempt ids', async () => {
    const { hooks, runtime } = createRuntime(['channel-a']);

    await expect(generate(runtime)).resolves.toEqual({ servedBy: 'channel-b' });

    const attempts = hooks.onRouteAttempt.mock.calls.map(([result]) => result as any);
    expect(attempts.map(({ channelId, success }) => ({ channelId, success }))).toEqual([
      { channelId: 'channel-a', success: false },
      { channelId: 'channel-b', success: true },
    ]);
    for (const attempt of attempts) expect(attempt).not.toHaveProperty('completionPending');
    expect(attempts[0].requestId).toBe(attempts[1].requestId);
    expect(attempts[0].attemptId).not.toBe(attempts[1].attemptId);

    expect(hooks.onRouteSuccess).toHaveBeenCalledTimes(1);
    expect(hooks.onRouteSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'channel-b', firstChannelId: 'channel-a' }),
    );
  });

  it('never reports route success when every channel fails', async () => {
    const { hooks, runtime } = createRuntime(['channel-a', 'channel-b']);

    await expect(generate(runtime)).rejects.toThrow('channel failed');

    expect(hooks.onRouteAttempt).toHaveBeenCalledTimes(2);
    expect(hooks.onRouteSuccess).not.toHaveBeenCalled();
  });
});
