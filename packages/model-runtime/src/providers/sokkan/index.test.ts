// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeSokkanAI, params } from './index';

testProvider({
  Runtime: LobeSokkanAI,
  provider: 'sokkan',
  defaultBaseURL: 'https://router.sokkan.ch/v1',
  chatDebugEnv: 'DEBUG_SOKKAN_CHAT_COMPLETION',
  chatModel: 'openai/gpt-oss-20b',
});

describe('LobeSokkanAI models', () => {
  it('keeps only on-demand models and maps limits and prices', async () => {
    const client = {
      models: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              available: true,
              availability: 'on_demand',
              context_length: 65_536,
              id: 'openai/gpt-oss-20b',
              max_output_tokens: 32_768,
              name: 'gpt-oss-20b',
              pricing: { cached: '0.008', completion: '0.075', prompt: '0.015' },
            },
            {
              available: false,
              availability: 'committed',
              context_length: 32_768,
              id: 'qwen/qwen3.6-35b-a3b',
              pricing: { cached: '0.05', completion: '1.40', prompt: '0.20' },
            },
            {
              available: true,
              availability: 'opportunistic',
              context_length: 65_536,
              id: 'qwen/qwen3.6-35b-a3b-swiss',
              pricing: { cached: '0.05', completion: '1.40', prompt: '0.20' },
            },
          ],
        }),
      },
    };

    const models = await params.models({ client: client as any });

    expect(models.map((m) => m.id)).toEqual(['openai/gpt-oss-20b']);
    expect(models[0]).toMatchObject({
      contextWindowTokens: 65_536,
      maxOutput: 32_768,
      pricing: {
        units: expect.arrayContaining([
          expect.objectContaining({ name: 'textInput', rate: 0.015 }),
          expect.objectContaining({ name: 'textOutput', rate: 0.075 }),
          expect.objectContaining({ name: 'textInput_cacheRead', rate: 0.008 }),
        ]),
      },
    });
  });
});
