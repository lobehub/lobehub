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
          options: [{ apiKey: 'channel-a' }, { apiKey: 'channel-b' }],
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
