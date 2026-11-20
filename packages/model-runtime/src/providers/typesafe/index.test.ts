// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LobeTypeSafeAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

describe('LobeTypeSafeAI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the official System One endpoint with Jev 1.14', async () => {
    const runtime = new LobeTypeSafeAI({ apiKey: 'test-key' });
    const post = vi.spyOn(runtime['runtime']['client'], 'post').mockResolvedValue({
      answers: { approve_refund: { noul: 0.97, type: 'noul' } },
      model: 'jev-1.14.0',
      usage: { input_tokens: 335, output_tokens: 21 },
    } as never);

    const result = await runtime.decide!(
      {
        model: 'jev-1.14.0',
        questions: {
          approve_refund: {
            instructions: 'Should this refund be approved?',
            type: 'boolean',
          },
        },
        state: { amount: 125, reason: 'duplicate charge' },
      },
      { user: 'internal-probe' },
    );

    expect(runtime.baseURL).toBe('https://api.typesafe.ai/v1');
    expect(post).toHaveBeenCalledWith(
      '/systemone',
      expect.objectContaining({
        body: {
          model: 'jev-1.14.0',
          questions: {
            approve_refund: {
              instructions: 'Should this refund be approved?',
              type: 'noul',
            },
          },
          state: { amount: 125, reason: 'duplicate charge' },
        },
        maxRetries: 0,
      }),
    );
    expect(result).toMatchObject({
      answers: { approve_refund: { probability: 0.97, type: 'boolean' } },
      model: 'jev-1.14.0',
      usage: {
        inputTextTokens: 335,
        outputTextTokens: 21,
        totalTokens: 356,
      },
    });
  });

  it('does not expose unsupported OpenAI-compatible capabilities', () => {
    const runtime = new LobeTypeSafeAI({ apiKey: 'test-key' });

    expect(runtime.chat).toBeUndefined();
    expect(runtime.embeddings).toBeUndefined();
    expect(runtime.generateObject).toBeUndefined();
    expect(runtime.models).toBeUndefined();
  });
});
