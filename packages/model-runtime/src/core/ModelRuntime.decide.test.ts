// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../types/error';
import { ModelRuntime, type ModelRuntimeHooks } from './ModelRuntime';

vi.mock('../providers/lobehub', () => ({
  LobeHubAI: class LobeHubAI {},
}));

const createMockRuntime = (hooks?: ModelRuntimeHooks) => {
  const mockRuntimeAI = { chat: vi.fn() } as any;
  return { runtime: new ModelRuntime(mockRuntimeAI, hooks), mockRuntimeAI };
};

const decidePayload = {
  model: 'typesafe/jev-1.13',
  questions: {
    refund: {
      criteria: { false: 'No refund requested.', true: 'Asks for money back.' },
      instructions: 'Is the customer asking for a refund?',
      type: 'boolean' as const,
    },
  },
  state: 'I was charged twice and want my money back.',
};

const decision = {
  answers: { refund: { probability: 0.99, type: 'boolean' } },
  model: 'typesafe/jev-1.13-20260917',
};

describe('ModelRuntime decide hooks', () => {
  it('passes the response and provider usage to onDecideFinal after beforeDecide', async () => {
    const usage = { cost: 0.000_018, inputTextTokens: 436, totalInputTokens: 436 };
    const beforeDecide = vi.fn();
    const onDecideFinal = vi.fn();
    const { runtime, mockRuntimeAI } = createMockRuntime({ beforeDecide, onDecideFinal });
    mockRuntimeAI.decide = vi.fn(async (_payload: any, options: any) => {
      await options.onUsage(usage);
      return decision;
    });

    const options = { user: 'u1' };
    const result = await runtime.decide(decidePayload, options);

    expect(result).toEqual(decision);
    expect(beforeDecide).toHaveBeenCalledWith(decidePayload, options);
    expect(onDecideFinal).toHaveBeenCalledWith(
      { latencyMs: expect.any(Number), response: decision, usage },
      { options, payload: decidePayload },
    );
  });

  it('passes the provider-reported charge to onDecideFinal and the caller callback', async () => {
    const onDecideFinal = vi.fn();
    const onProviderReportedCost = vi.fn();
    const { runtime, mockRuntimeAI } = createMockRuntime({ onDecideFinal });
    mockRuntimeAI.decide = vi.fn(async (_payload: any, options: any) => {
      await options.onProviderReportedCost(0.000_018);
      return decision;
    });

    const result = await runtime.decide(decidePayload, { onProviderReportedCost });

    expect(result).toEqual(decision);
    expect(onProviderReportedCost).toHaveBeenCalledWith(0.000_018);
    expect(onDecideFinal).toHaveBeenCalledWith(
      expect.objectContaining({ providerReportedCost: 0.000_018, response: decision }),
      expect.anything(),
    );
  });

  it('calls onDecideError and re-throws when the provider fails', async () => {
    const providerError = { errorType: 'ProviderBizError', error: { message: 'boom' } };
    const onDecideError = vi.fn();
    const onDecideFinal = vi.fn();
    const { runtime, mockRuntimeAI } = createMockRuntime({ onDecideError, onDecideFinal });
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(providerError);

    await expect(runtime.decide(decidePayload)).rejects.toBe(providerError);
    expect(onDecideFinal).not.toHaveBeenCalled();
    expect(onDecideError).toHaveBeenCalledWith(providerError, {
      options: undefined,
      payload: decidePayload,
    });
  });

  it('rejects instead of resolving undefined when the provider cannot decide', async () => {
    const beforeDecide = vi.fn();
    const { runtime } = createMockRuntime({ beforeDecide });

    await expect(runtime.decide(decidePayload)).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.CapabilityNotSupported,
    });
    expect(beforeDecide).not.toHaveBeenCalled();
  });
});
