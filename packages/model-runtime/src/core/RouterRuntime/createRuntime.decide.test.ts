import { AgentRuntimeErrorType, RequestTrigger } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

describe('createRouterRuntime decide', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('should route decide calls and record the lobehub route attempt', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const decision = {
      answers: { refund: { probability: 0.9, type: 'predicate' } },
      model: 'jev',
    };
    const mockDecide = vi.fn().mockResolvedValue(decision);

    class MockRuntime implements LobeRuntimeAI {
      decide = mockDecide;
    }

    const Runtime = createRouterRuntime({
      id: 'lobehub',
      routers: [
        {
          apiType: 'openai',
          models: ['typesafe/jev-1.13'],
          options: { id: 'channel-1' },
          runtime: MockRuntime as any,
        },
      ],
    });

    const runtime = new Runtime({ userId: 'user-1' });
    const metadata: Record<string, unknown> = { trigger: RequestTrigger.Api };

    await expect(
      runtime.decide(
        {
          model: 'typesafe/jev-1.13',
          questions: {
            refund: {
              criteria: { false: 'no', true: 'yes' },
              instructions: 'Refund request?',
              type: 'predicate',
            },
          },
          state: 'Give me my money back',
        },
        { metadata, user: 'user-1' },
      ),
    ).resolves.toEqual(decision);
    expect(metadata.routeAttempt).toEqual(expect.objectContaining({ success: true }));
  });

  it('should reject decide when the matched runtime cannot decide', async () => {
    class MockRuntime implements LobeRuntimeAI {}

    const Runtime = createRouterRuntime({
      id: 'test-runtime',
      routers: [
        {
          apiType: 'openai',
          models: ['typesafe/jev-1.13'],
          options: {},
          runtime: MockRuntime as any,
        },
      ],
    });

    await expect(
      new Runtime().decide({ model: 'typesafe/jev-1.13', questions: {}, state: 'x' }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.CapabilityNotSupported });
  });
});
