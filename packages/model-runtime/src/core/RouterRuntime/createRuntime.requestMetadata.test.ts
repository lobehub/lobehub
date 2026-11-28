import { describe, expect, it, vi } from 'vitest';

import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

class MockRuntime implements LobeRuntimeAI {
  chat = vi.fn().mockResolvedValue(new Response('chat-response'));
  generateObject = vi.fn().mockResolvedValue({});
}

const createRuntime = () => {
  const routers = vi.fn(() => [
    {
      apiType: 'openai' as const,
      models: ['request-model'],
      options: {},
      runtime: MockRuntime as any,
    },
  ]);
  const Runtime = createRouterRuntime({ id: 'test-runtime', routers });

  return { routers, runtime: new Runtime() };
};

describe('RouterRuntime request metadata', () => {
  it('forwards chat request metadata to dynamic routers', async () => {
    const { routers, runtime } = createRuntime();

    await runtime.chat({ messages: [], model: 'request-model', temperature: 1 } as any, {
      metadata: { topicId: 'tpc_1' },
    });

    expect(routers).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ metadata: expect.objectContaining({ topicId: 'tpc_1' }) }),
    );
  });

  it('forwards generateObject request metadata to dynamic routers', async () => {
    const { routers, runtime } = createRuntime();

    await runtime.generateObject(
      {
        messages: [],
        model: 'request-model',
        schema: { name: 'result', schema: { properties: {}, type: 'object' } },
      },
      { metadata: { topicId: 'tpc_2' } },
    );

    expect(routers).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ metadata: expect.objectContaining({ topicId: 'tpc_2' }) }),
    );
  });

  it('omits metadata from the router context when the request has none', async () => {
    const { routers, runtime } = createRuntime();

    await runtime.chat({ messages: [], model: 'request-model', temperature: 1 } as any);

    expect(routers).toHaveBeenCalledWith(expect.any(Object), { model: 'request-model' });
  });
});
