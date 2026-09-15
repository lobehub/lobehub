// @vitest-environment node
import { ModelRuntime } from '@lobechat/model-runtime';
import { describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { RuntimeExecutorContext } from '../context';
import { ServerLLMTransport } from './ServerLLMTransport';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('ServerLLMTransport.stream · conversation affinity', () => {
  it('retains the conversation ID across compression requests and runtime recreation', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    for (const topicId of ['topic-1', 'topic-1', 'topic-2']) {
      const ctx = { topicId, userId: 'user-1' } as RuntimeExecutorContext;
      await new ServerLLMTransport(ctx).stream({
        messages: [],
        model: 'glm-5',
        provider: 'opencodecodingplan',
      });
    }

    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls.map(([, options]) => options.metadata.topicId)).toEqual([
      'topic-1',
      'topic-1',
      'topic-2',
    ]);
  });
});
