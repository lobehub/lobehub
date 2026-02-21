// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { XAIModelCard } from './index';
import { isGrokReasoningModel, LobeXAI } from './index';

testProvider({
  Runtime: LobeXAI,
  provider: ModelProvider.XAI,
  defaultBaseURL: 'https://api.x.ai/v1',
  chatDebugEnv: 'DEBUG_XAI_CHAT_COMPLETION',
  chatModel: 'grok',
});

describe('LobeXAI - custom features', () => {
  let instance: InstanceType<typeof LobeXAI>;

  beforeEach(() => {
    instance = new LobeXAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('isGrokReasoningModel', () => {
    it('should identify Grok reasoning models correctly', () => {
      expect(isGrokReasoningModel('grok-3-mini')).toBe(true);
      expect(isGrokReasoningModel('grok-4')).toBe(true);
      expect(isGrokReasoningModel('grok-code')).toBe(true);
      expect(isGrokReasoningModel('grok-2')).toBe(false);
      expect(isGrokReasoningModel('other-model')).toBe(false);
    });
  });

  describe('chat with handlePayload', () => {
    it('should handle Grok reasoning models by removing frequency_penalty and presence_penalty', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4',
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.frequency_penalty).toBeUndefined();
      expect(calledPayload.presence_penalty).toBeUndefined();
      expect(calledPayload.model).toBe('grok-4');
    });

    it('should keep frequency_penalty and presence_penalty for non-reasoning models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-2',
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.frequency_penalty).toBe(0.5);
      expect(calledPayload.presence_penalty).toBe(0.3);
    });

    it('should add search_parameters when enabledSearch is true', async () => {
      process.env.XAI_MAX_SEARCH_RESULTS = '10';
      process.env.XAI_SAFE_SEARCH = '1';

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-2',
        enabledSearch: true,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.search_parameters).toBeDefined();
      expect(calledPayload.search_parameters.max_search_results).toBe(10);
      expect(calledPayload.search_parameters.mode).toBe('auto');
      expect(calledPayload.search_parameters.return_citations).toBe(true);
      expect(calledPayload.search_parameters.sources).toHaveLength(3);

      delete process.env.XAI_MAX_SEARCH_RESULTS;
      delete process.env.XAI_SAFE_SEARCH;
    });

    it('should not add search_parameters when enabledSearch is false', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-2',
        enabledSearch: false,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.search_parameters).toBeUndefined();
    });
  });

  describe('models', () => {
    it('should fetch and process model list correctly', async () => {
      const mockModelList: XAIModelCard[] = [
        { id: 'grok-2' },
        { id: 'grok-3-mini' },
        { id: 'grok-4' },
      ];

      vi.spyOn(instance['client'].models, 'list').mockResolvedValue({
        data: mockModelList,
      } as any);

      const models = await instance.models();

      expect(instance['client'].models.list).toHaveBeenCalled();
      expect(models.length).toBeGreaterThan(0);
    });
  });
});
