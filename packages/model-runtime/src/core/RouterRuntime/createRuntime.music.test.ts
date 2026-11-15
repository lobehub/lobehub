import { describe, expect, it, vi } from 'vitest';

import type { CreateMusicPayload } from '../../types';
import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

const payload: CreateMusicPayload = { model: 'song-model', params: { prompt: 'a happy song' } };

describe('createRouterRuntime music', () => {
  it('submits and polls on the same channel and never falls back to another one', async () => {
    const submitKeys: string[] = [];
    const pollKeys: string[] = [];

    class MockMusicRuntime implements LobeRuntimeAI {
      private apiKey: string;
      constructor({ apiKey }: { apiKey: string }) {
        this.apiKey = apiKey;
      }
      createMusic = vi.fn(async () => {
        submitKeys.push(this.apiKey);
        if (this.apiKey === 'channel-a') throw new Error('channel A is busy');
        return { inferenceId: 'task-1', status: 'pending' as const };
      });
      handlePollMusicStatus = vi.fn(async () => {
        pollKeys.push(this.apiKey);
        return { status: 'pending' as const };
      });
    }

    const Runtime = createRouterRuntime({
      id: 'music-router',
      routers: [
        {
          apiType: 'openai',
          models: ['song-model'],
          options: [
            { apiKey: 'channel-a', id: 'a' },
            { apiKey: 'channel-b', id: 'b' },
          ],
          runtime: MockMusicRuntime as any,
        },
      ],
    });
    const runtime = new Runtime();

    // A fallback submit on channel B would leave the task unreachable for polling on A.
    await expect(runtime.createMusic(payload)).rejects.toThrow('channel A is busy');
    expect(submitKeys).toEqual(['channel-a']);

    await runtime.handlePollMusicStatus('task-1', 'song-model');
    expect(pollKeys).toEqual(['channel-a']);
  });

  it('forwards the poll options to the channel runtime', async () => {
    const handlePollMusicStatus = vi.fn(async () => ({ status: 'pending' as const }));

    class MockMusicRuntime implements LobeRuntimeAI {
      handlePollMusicStatus = handlePollMusicStatus;
    }

    const Runtime = createRouterRuntime({
      id: 'music-router',
      routers: [
        {
          apiType: 'openai',
          models: ['song-model'],
          options: [{ apiKey: 'channel-a', id: 'a' }],
          runtime: MockMusicRuntime as any,
        },
      ],
    });
    const controller = new AbortController();

    await new Runtime().handlePollMusicStatus('task-1', 'song-model', undefined, {
      signal: controller.signal,
    });

    expect(handlePollMusicStatus).toHaveBeenCalledWith('task-1', 'song-model', undefined, {
      signal: controller.signal,
    });
  });

  it('returns the accepting channel as route and polls that pinned channel', async () => {
    const pollKeys: string[] = [];

    class MockMusicRuntime implements LobeRuntimeAI {
      private apiKey: string;
      constructor({ apiKey }: { apiKey: string }) {
        this.apiKey = apiKey;
      }
      createMusic = vi.fn(async () => ({ inferenceId: 'task-1', status: 'pending' as const }));
      handlePollMusicStatus = vi.fn(async () => {
        pollKeys.push(this.apiKey);
        return { status: 'pending' as const };
      });
    }

    const Runtime = createRouterRuntime({
      id: 'music-router',
      routers: [
        {
          apiType: 'openai',
          id: 'music-router',
          models: ['song-model'],
          options: [
            { apiKey: 'channel-a', id: 'a' },
            { apiKey: 'channel-b', id: 'b' },
          ],
          runtime: MockMusicRuntime as any,
        },
      ],
    });
    const runtime = new Runtime();

    await expect(runtime.createMusic(payload)).resolves.toEqual({
      inferenceId: 'task-1',
      route: { channelId: 'a', model: 'song-model', routerId: 'music-router' },
      status: 'pending',
    });

    // Without a model the poll still reaches the pinned channel, not the default one.
    await runtime.handlePollMusicStatus('task-1', undefined, { channelId: 'b' });
    expect(pollKeys).toEqual(['channel-b']);

    await expect(
      runtime.handlePollMusicStatus('task-1', 'song-model', { channelId: 'gone' }),
    ).rejects.toThrow('The music generation route is no longer available');
  });

  it('submits to the first channel after sorting, without falling back', async () => {
    const submitKeys: string[] = [];

    class MockMusicRuntime implements LobeRuntimeAI {
      private apiKey: string;
      constructor({ apiKey }: { apiKey: string }) {
        this.apiKey = apiKey;
      }
      createMusic = vi.fn(async () => {
        submitKeys.push(this.apiKey);
        return { inferenceId: 'task-1', status: 'pending' as const };
      });
    }

    const Runtime = createRouterRuntime({
      id: 'music-router',
      routers: [
        {
          apiType: 'openai',
          id: 'music-router',
          models: ['song-model'],
          options: [
            { apiKey: 'channel-a', id: 'a' },
            { apiKey: 'channel-b', id: 'b' },
          ],
          runtime: MockMusicRuntime as any,
        },
      ],
      // Demote channel A, e.g. after it was marked unhealthy.
      sortRouterOptions: async ({ options }: { options: { id?: string }[] }) =>
        [...options].reverse(),
    } as any);

    await expect(new Runtime().createMusic(payload)).resolves.toMatchObject({
      route: { channelId: 'b', routerId: 'music-router' },
    });
    expect(submitKeys).toEqual(['channel-b']);
  });

  it('pins an id-less sorted channel by its position', async () => {
    const pollKeys: string[] = [];

    class MockMusicRuntime implements LobeRuntimeAI {
      private apiKey: string;
      constructor({ apiKey }: { apiKey: string }) {
        this.apiKey = apiKey;
      }
      createMusic = vi.fn(async () => ({ inferenceId: 'task-1', status: 'pending' as const }));
      handlePollMusicStatus = vi.fn(async () => {
        pollKeys.push(this.apiKey);
        return { status: 'pending' as const };
      });
    }

    const Runtime = createRouterRuntime({
      id: 'music-router',
      routers: [
        {
          apiType: 'openai',
          models: ['song-model'],
          options: [{ apiKey: 'channel-a' }, { apiKey: 'channel-b' }],
          runtime: MockMusicRuntime as any,
        },
      ],
      sortRouterOptions: async ({ options }: { options: unknown[] }) => [...options].reverse(),
    } as any);
    const runtime = new Runtime();

    const created = await runtime.createMusic(payload);
    expect(created).toMatchObject({ route: { channelIndex: 1 }, status: 'pending' });

    await runtime.handlePollMusicStatus(
      'task-1',
      'song-model',
      created?.status === 'pending' ? created.route : undefined,
    );
    expect(pollKeys).toEqual(['channel-b']);
  });

  it('polls a model-dependent router from the route alone', async () => {
    const pollKeys: string[] = [];

    class MockMusicRuntime implements LobeRuntimeAI {
      private apiKey: string;
      constructor({ apiKey }: { apiKey: string }) {
        this.apiKey = apiKey;
      }
      createMusic = vi.fn(async () => ({ inferenceId: 'task-1', status: 'pending' as const }));
      handlePollMusicStatus = vi.fn(async () => {
        pollKeys.push(this.apiKey);
        return { status: 'pending' as const };
      });
    }

    const Runtime = createRouterRuntime({
      id: 'music-router',
      // Only emits the music router once it knows the model.
      routers: (_options: unknown, context?: { model?: string }) =>
        context?.model === 'song-model'
          ? [
              {
                apiType: 'openai',
                id: 'music-router',
                options: [{ apiKey: 'music-key', id: 'm' }],
                runtime: MockMusicRuntime as any,
              },
            ]
          : [
              {
                apiType: 'openai',
                id: 'chat-router',
                options: {},
                runtime: MockMusicRuntime as any,
              },
            ],
    } as any);
    const runtime = new Runtime();

    const created = await runtime.createMusic(payload);
    expect(created).toMatchObject({ route: { model: 'song-model', routerId: 'music-router' } });

    await runtime.handlePollMusicStatus(
      'task-1',
      undefined,
      created?.status === 'pending' ? created.route : undefined,
    );
    expect(pollKeys).toEqual(['music-key']);
  });

  it('reports the serving channel through onRouteSuccess and onRouteAttempt', async () => {
    class MockMusicRuntime implements LobeRuntimeAI {
      createMusic = vi.fn(async () => ({ inferenceId: 'task-1', status: 'pending' as const }));
    }
    const onRouteSuccess = vi.fn();
    const onRouteAttempt = vi.fn(async () => {});

    const Runtime = createRouterRuntime({
      id: 'music-router',
      onRouteAttempt,
      onRouteSuccess,
      routers: [
        {
          apiType: 'openai',
          id: 'music-router',
          models: ['song-model'],
          options: [{ apiKey: 'channel-a', id: 'a' }],
          runtime: MockMusicRuntime as any,
        },
      ],
    } as any);

    await new Runtime().createMusic(payload);

    expect(onRouteSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'a',
        method: 'createMusic',
        model: 'song-model',
        routerId: 'music-router',
      }),
    );
    expect(onRouteAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'a', success: true }),
    );
  });

  it('carries the request trigger so a lobehub route attempt passes the dev context guard', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const createMusic = vi.fn(async () => ({ inferenceId: 'task-1', status: 'pending' as const }));

    class MockMusicRuntime implements LobeRuntimeAI {
      createMusic = createMusic;
    }

    const Runtime = createRouterRuntime({
      id: 'lobehub',
      routers: [
        {
          apiType: 'fal',
          models: ['song-model'],
          options: [{ apiKey: 'channel-a', id: 'a' }],
          runtime: MockMusicRuntime as any,
        },
      ],
    });
    const runtime = new Runtime({ userId: 'user-1' });

    // Without a trigger the development guard rejects the attempt before it reaches the channel
    await expect(runtime.createMusic(payload)).rejects.toThrow('"missingTrigger":true');
    expect(createMusic).not.toHaveBeenCalled();

    await expect(runtime.createMusic(payload, { metadata: { trigger: 'music' } })).resolves.toEqual(
      expect.objectContaining({ inferenceId: 'task-1' }),
    );
    expect(createMusic).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('reports runtimes without music support', async () => {
    class ChatOnlyRuntime implements LobeRuntimeAI {}

    const Runtime = createRouterRuntime({
      id: 'chat-router',
      routers: [{ apiType: 'openai', options: {}, runtime: ChatOnlyRuntime as any }],
    });

    await expect(new Runtime().createMusic(payload)).rejects.toThrow(
      'Music generation is not supported by the matched runtime',
    );
    await expect(new Runtime().handlePollMusicStatus('task-1')).rejects.toThrow(
      'Music polling is not supported by the matched runtime',
    );
  });
});
