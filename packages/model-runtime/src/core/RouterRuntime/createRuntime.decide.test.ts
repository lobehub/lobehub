import { AgentRuntimeErrorType, RequestTrigger } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DecisionBooleanAnswer, DecisionRefusalAnswer } from '../../types';
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
      answers: { refund: { probability: 0.9, type: 'boolean' } },
      model: 'jev',
    };
    const mockDecide = vi.fn().mockResolvedValue(decision);
    const onRouteAttempt = vi.fn().mockResolvedValue(undefined);

    class MockRuntime implements LobeRuntimeAI {
      decide = mockDecide;
    }

    const Runtime = createRouterRuntime({
      id: 'lobehub',
      onRouteAttempt,
      routers: [
        {
          apiType: 'openai',
          models: ['typesafe/jev-1.13'],
          options: { id: 'channel-1' },
          runtime: MockRuntime as any,
        },
      ],
    });

    const runtime = new Runtime();
    const metadata: Record<string, unknown> = {
      traceId: 'signup-flow-1',
      trigger: RequestTrigger.SignupEmailLLMReview,
    };

    const result = await runtime.decide(
      {
        model: 'typesafe/jev-1.13',
        questions: {
          refund: {
            criteria: { false: 'no', true: 'yes' },
            instructions: 'Refund request?',
            type: 'boolean',
          },
        },
        state: 'Give me my money back',
      },
      { metadata },
    );

    expect(result).toEqual(decision);
    const refund: DecisionBooleanAnswer | DecisionRefusalAnswer = result.answers.refund;
    expect(refund.type).toBe('boolean');
    if (refund.type === 'boolean') expect(refund.probability).toBe(0.9);
    expect(metadata.routeAttempt).toEqual(expect.objectContaining({ success: true }));
    expect(onRouteAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ traceId: 'signup-flow-1' }),
        userId: undefined,
      }),
    );
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
