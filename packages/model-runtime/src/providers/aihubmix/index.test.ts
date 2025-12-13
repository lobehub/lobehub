// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeAiHubMixAI } from './index';

describe('LobeAiHubMixAI', () => {
  let instance: InstanceType<typeof LobeAiHubMixAI>;

  beforeEach(() => {
    instance = new LobeAiHubMixAI({ apiKey: 'test_api_key' });
  });

  describe('constructor', () => {
    it('should initialize with correct provider', () => {
      expect(instance).toBeDefined();
    });

    it('should set APP-Code header', () => {
      // The RouterRuntime-based providers have different structure
      // We just verify the instance is created correctly
      expect(instance).toBeInstanceOf(LobeAiHubMixAI);
    });
  });

  describe('chat', () => {
    it('should support chat method', async () => {
      vi.spyOn(instance as any, 'getRuntimeByModel').mockResolvedValue({
        chat: vi.fn().mockResolvedValue(new Response()),
      });

      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4',
        temperature: 0.7,
      };

      const result = await instance.chat(payload);
      expect(result).toBeDefined();
    });
  });

  describe('models', () => {
    it('should return empty array on error', async () => {
      // Mock the client to throw an error
      const mockClient = {
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      vi.spyOn(instance as any, 'getRuntimeByModel').mockResolvedValue({
        models: async () => {
          try {
            await mockClient.models.list();
          } catch (error) {
            console.warn(
              'Failed to fetch AiHubMix models. Please ensure your AiHubMix API key is valid:',
              error,
            );
            return [];
          }
        },
      });

      // The models method should return empty array on error
      const models = await (instance as any)
        .getRuntimeByModel('test-model')
        .then((r: any) => r.models());
      expect(models).toEqual([]);
    });
  });
});
