// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeYAPIAI, params } from './index';

const provider = ModelProvider.YAPI;
const defaultBaseURL = 'https://api.y-api.bestvirtualgoods.com/v1';

testProvider({
  Runtime: LobeYAPIAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_YAPI_CHAT_COMPLETION',
  chatModel: 'deepseek/deepseek-v4-flash',
});

describe('LobeYAPIAI - custom features', () => {
  describe('chatCompletion.handlePayload', () => {
    it('should keep max_tokens for the models that accept it', () => {
      const result = params.chatCompletion!.handlePayload!({
        max_tokens: 1024,
        model: 'deepseek/deepseek-v4-flash',
      } as any);

      expect(result.max_tokens).toBe(1024);
      expect(result.max_completion_tokens).toBeUndefined();
    });

    it('should map max_tokens to max_completion_tokens for the gpt-6 family', () => {
      const result = params.chatCompletion!.handlePayload!({
        max_tokens: 1024,
        model: 'openai/gpt-6-astra',
      } as any);

      expect(result.max_completion_tokens).toBe(1024);
      expect(result.max_tokens).toBeUndefined();
    });

    it('should omit the output limit when the caller did not set one', () => {
      const result = params.chatCompletion!.handlePayload!({
        model: 'openai/gpt-6-astra',
      } as any);

      expect(result.max_tokens).toBeUndefined();
      expect(result.max_completion_tokens).toBeUndefined();
    });

    it('should default stream to true', () => {
      const result = params.chatCompletion!.handlePayload!({ model: 'z-ai/glm-5.3' } as any);

      expect(result.stream).toBe(true);
    });

    it('should preserve an explicit stream value', () => {
      const result = params.chatCompletion!.handlePayload!({
        model: 'z-ai/glm-5.3',
        stream: false,
      } as any);

      expect(result.stream).toBe(false);
    });
  });

  describe('models', () => {
    it('should return the model list served by the relay', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'deepseek/deepseek-v4-flash', object: 'model', owned_by: 'y-api' },
              { id: 'openai/gpt-6-astra', object: 'model', owned_by: 'y-api' },
              { id: 'z-ai/glm-5.3', object: 'model', owned_by: 'y-api' },
            ],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(3);
      expect(models.map((model) => model.id)).toEqual([
        'deepseek/deepseek-v4-flash',
        'openai/gpt-6-astra',
        'z-ai/glm-5.3',
      ]);
    });
  });
});
