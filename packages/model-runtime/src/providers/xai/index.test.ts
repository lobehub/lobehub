// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
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
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(new ReadableStream() as any);
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

      const calledPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
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

      const calledPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(calledPayload.frequency_penalty).toBe(0.5);
      expect(calledPayload.presence_penalty).toBe(0.3);
    });

    it('should use responses API when enabledSearch is true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-2',
        enabledSearch: true,
      });

      expect(instance['client'].responses.create).toHaveBeenCalled();
      expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
    });

    it('should not use responses API when enabledSearch is false', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-2',
        enabledSearch: false,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalled();
      expect(instance['client'].responses.create).not.toHaveBeenCalled();
    });
  });

  describe('responses.handlePayload', () => {
    it('should add web_search and x_search tools when enabledSearch is true', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-2',
        tools: [{ function: { description: 'test', name: 'test' }, type: 'function' as const }],
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.tools).toEqual([
        { description: 'test', name: 'test', type: 'function' },
        { type: 'web_search' },
        { type: 'x_search' },
      ]);
    });

    it('should add web_search and x_search without existing tools', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-2',
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.tools).toEqual([{ type: 'web_search' }, { type: 'x_search' }]);
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
