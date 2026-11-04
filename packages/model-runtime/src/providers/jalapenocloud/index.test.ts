// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeJalapenoCloudAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

testProvider({
  Runtime: LobeJalapenoCloudAI,
  bizErrorType: 'ProviderBizError',
  chatDebugEnv: 'DEBUG_JALAPENOCLOUD_CHAT_COMPLETION',
  chatModel: 'DeepSeek-V4-Pro',
  defaultBaseURL: 'https://api.jalapeno-cloud.ai/v1',
  invalidErrorType: 'InvalidProviderAPIKey',
  provider: ModelProvider.JalapenoCloud,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeJalapenoCloudAI - custom features', () => {
  let instance: InstanceType<typeof LobeJalapenoCloudAI>;

  beforeEach(() => {
    instance = new LobeJalapenoCloudAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params object', () => {
    it('should export params with correct baseURL and provider', () => {
      expect(params.baseURL).toBe('https://api.jalapeno-cloud.ai/v1');
      expect(params.provider).toBe(ModelProvider.JalapenoCloud);
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_JALAPENOCLOUD_CHAT_COMPLETION;
      expect(params.debug.chatCompletion()).toBe(false);
    });

    it('should enable debug when env is set to "1"', () => {
      process.env.DEBUG_JALAPENOCLOUD_CHAT_COMPLETION = '1';
      expect(params.debug.chatCompletion()).toBe(true);
      delete process.env.DEBUG_JALAPENOCLOUD_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should map enabled thinking to chat_template_kwargs', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'DeepSeek-V4-Pro',
        thinking: { budget_tokens: 1024, type: 'enabled' },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.chat_template_kwargs).toEqual({ thinking: true });
      expect(calledPayload.thinking).toBeUndefined();
      expect(calledPayload.model).toBe('DeepSeek-V4-Pro');
    });

    it('should map disabled thinking to chat_template_kwargs', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'DeepSeek-V4-Pro',
        thinking: { budget_tokens: 1024, type: 'disabled' },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.chat_template_kwargs).toEqual({ thinking: false });
    });

    it('should omit chat_template_kwargs when thinking is not provided', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'DeepSeek-V4-Pro',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.chat_template_kwargs).toBeUndefined();
    });
  });

  describe('models function', () => {
    it('should fetch and process models', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'DeepSeek-V4-Pro', object: 'model', owned_by: 'deepseek' },
              { created: 1, id: 'GLM-5', object: 'model', owned_by: 'zhipu' },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'DeepSeek-V4-Pro' }),
          expect.objectContaining({ id: 'GLM-5' }),
        ]),
      );
    });
  });
});
