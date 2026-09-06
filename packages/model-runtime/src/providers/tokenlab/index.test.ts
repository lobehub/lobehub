// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import * as modelParse from '../../utils/modelParse';
import { params } from './index';

const resolveRouters = (baseURL?: string, model?: string) =>
  (params.routers as any)({ apiKey: 'test', baseURL }, { model });

describe('LobeTokenLabAI', () => {
  describe('params', () => {
    it('uses the TokenLab provider id', () => {
      expect(params.id).toBe(ModelProvider.TokenLab);
    });
  });

  describe('routers', () => {
    it('routes supported model families through native API surfaces', () => {
      const routers = resolveRouters('https://api.tokenlab.sh/v1', 'claude-sonnet-5');
      const baseOf = (apiType: string) =>
        routers.find((router: any) => router.apiType === apiType).options.baseURL;

      expect(baseOf('anthropic')).toBe('https://api.tokenlab.sh');
      expect(baseOf('google')).toBe('https://api.tokenlab.sh');
      expect(baseOf('openai')).toBe('https://api.tokenlab.sh/v1');

      expect(routers.find((router: any) => router.apiType === 'anthropic').models).toContain(
        'claude-sonnet-5',
      );
      expect(routers.find((router: any) => router.apiType === 'google').models).toContain(
        'gemini-3.5-flash',
      );
      expect(routers.find((router: any) => router.apiType === 'xai').models).toContain(
        'grok-4-fast',
      );
      expect(routers.find((router: any) => router.apiType === 'deepseek').models).toContain(
        'deepseek-v4-pro',
      );
    });
  });

  describe('models', () => {
    it('maps TokenLab catalog metadata into LobeHub model cards', async () => {
      const spy = vi.spyOn(modelParse, 'processMultiProviderModelList').mockResolvedValueOnce([]);
      const client = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'gemini-3.5-flash',
                object: 'model',
                owned_by: 'google',
                tokenlab: {
                  cache_pricing: { cache_read_per_1m: '0.075' },
                  capabilities: ['tool-use', 'json-mode', 'vision'],
                  category: 'chat',
                  max_input_tokens: 1_048_576,
                  max_output_tokens: 65_536,
                  pricing: { input_per_1m: '0.75', output_per_1m: '4.5' },
                },
              },
            ],
          }),
        },
      };

      await params.models?.({ client: client as any });

      expect(spy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            contextWindowTokens: 1_048_576,
            functionCall: true,
            id: 'gemini-3.5-flash',
            maxOutput: 65_536,
            organization: 'google',
            pricing: { cachedInput: 0.075, input: 0.75, output: 4.5 },
            structuredOutput: true,
            type: 'chat',
            vision: true,
          }),
        ]),
        'tokenlab',
      );
    });
  });
});
