import { describe, expect, it, vi } from 'vitest';

import type { CreateMusicPayload } from '../../types';
import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

const payload: CreateMusicPayload = { model: 'suno-v5', params: { prompt: 'a happy song' } };

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
          models: ['suno-v5'],
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

    await runtime.handlePollMusicStatus('task-1', 'suno-v5');
    expect(pollKeys).toEqual(['channel-a']);
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
          id: 'suno-router',
          models: ['suno-v5'],
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
      route: { channelId: 'a', routerId: 'suno-router' },
      status: 'pending',
    });

    // Without a model the poll still reaches the pinned channel, not the default one.
    await runtime.handlePollMusicStatus('task-1', undefined, { channelId: 'b' });
    expect(pollKeys).toEqual(['channel-b']);

    await expect(
      runtime.handlePollMusicStatus('task-1', 'suno-v5', { channelId: 'gone' }),
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
          id: 'suno-router',
          models: ['suno-v5'],
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
      route: { channelId: 'b', routerId: 'suno-router' },
    });
    expect(submitKeys).toEqual(['channel-b']);
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
