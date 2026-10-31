// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeLiquidInferenceAI } from './index';

const provider = ModelProvider.LiquidInference;
const defaultBaseURL = 'https://router.inference.ai.exchange/v1';

testProvider({
  Runtime: LobeLiquidInferenceAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_LIQUIDINFERENCE_CHAT_COMPLETION',
  chatModel: 'liquid.auto',
});

vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeLiquidInferenceAI({ apiKey: 'test' });
  vi.spyOn(instance['client'].models, 'list').mockResolvedValue({ data: [] } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LiquidInference', () => {
  it('sends X-Title so the exchange names LobeHub on its receipts', () => {
    expect(instance['client']['_options'].defaultHeaders).toMatchObject({ 'X-Title': 'LobeHub' });
  });

  describe('models', () => {
    it('maps the exchange model card and leaves out models that are not chat', async () => {
      (instance['client'].models.list as Mock).mockResolvedValue({
        data: [
          {
            context_length: 200_000,
            id: 'acme/vision-model',
            liquid_supported_parameters: ['tools', 'input.image', 'reasoning'],
            max_tokens: 8192,
            min_input_rate: 0.5,
            min_output_rate: 1.5,
          },
          { id: 'acme/painter', kind: 'image_generation' },
        ],
      });

      const list = await instance.models();

      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        contextWindowTokens: 200_000,
        functionCall: true,
        id: 'acme/vision-model',
        maxOutput: 8192,
        pricing: { input: 0.5, output: 1.5 },
        reasoning: true,
        vision: true,
      });
    });

    it('omits pricing when no offer quotes a token price', async () => {
      (instance['client'].models.list as Mock).mockResolvedValue({
        data: [{ context_length: 8000, id: 'liquid.auto', min_input_rate: null }],
      });

      const [model] = await instance.models();

      expect(model.pricing).toBeUndefined();
    });
  });
});
