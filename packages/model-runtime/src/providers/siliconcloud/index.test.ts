// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { AgentRuntimeErrorType } from '../../types/error';
import type { SiliconCloudModelCard } from './index';
import { LobeSiliconCloudAI } from './index';

testProvider({
  Runtime: LobeSiliconCloudAI,
  provider: ModelProvider.SiliconCloud,
  defaultBaseURL: 'https://api.siliconflow.cn/v1',
  chatDebugEnv: 'DEBUG_SILICONCLOUD_CHAT_COMPLETION',
  chatModel: 'Qwen/Qwen2.5-7B-Instruct',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeSiliconCloudAI - custom features', () => {
  let instance: InstanceType<typeof LobeSiliconCloudAI>;

  beforeEach(() => {
    instance = new LobeSiliconCloudAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('handlePayload', () => {
    it('should limit max_tokens to 16384', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Qwen/Qwen2.5-7B-Instruct',
        max_tokens: 20000,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.max_tokens).toBe(16384);
    });

    it('should ensure max_tokens is at least 1', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Qwen/Qwen2.5-7B-Instruct',
        max_tokens: 0,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.max_tokens).toBe(1);
    });

    it('should handle thinking with enable_thinking for GLM-4.5 models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'THUDM/GLM-4.5',
        thinking: {
          type: 'enabled',
          budget_tokens: 1000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.thinking_budget).toBe(1000);
    });

    it('should handle thinking with thinking_budget for Qwen3 models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Qwen/Qwen3-8B',
        thinking: {
          type: 'enabled',
          budget_tokens: 2000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.thinking_budget).toBe(2000);
    });

    it('should handle thinking with thinking_budget for DeepSeek-V3.1', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-ai/DeepSeek-V3.1',
        thinking: {
          type: 'enabled',
          budget_tokens: 3000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.thinking_budget).toBe(3000);
    });

    it('should limit thinking_budget to 32768', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'THUDM/GLM-4.5',
        thinking: {
          type: 'enabled',
          budget_tokens: 50000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking_budget).toBe(32768);
    });

    it('should set thinking_budget to 1 when budget_tokens is 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'THUDM/GLM-4.5',
        thinking: {
          type: 'enabled',
          budget_tokens: 0,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking_budget).toBe(1);
    });

    it('should not add enable_thinking for non-hybrid models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Qwen/Qwen2.5-7B-Instruct',
        thinking: {
          type: 'enabled',
          budget_tokens: 1000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.enable_thinking).toBeUndefined();
      expect(calledPayload.thinking_budget).toBe(1000);
    });
  });

  describe('handleError', () => {
    it('should handle 401 error as InvalidProviderAPIKey', async () => {
      const error = new Response('Unauthorized', { status: 401 });

      vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(error);

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'Qwen/Qwen2.5-7B-Instruct',
        });
      } catch (e: any) {
        expect(e.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      }
    });

    it('should handle 403 error as ProviderBizError with custom message', async () => {
      const error = new Response('Forbidden', { status: 403 });

      vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(error);

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'Qwen/Qwen2.5-7B-Instruct',
        });
      } catch (e: any) {
        expect(e.errorType).toBe(AgentRuntimeErrorType.ProviderBizError);
        expect(e.message).toContain('Please check if the API Key balance is sufficient');
      }
    });
  });

  describe('models', () => {
    it('should fetch and process model list correctly', async () => {
      const mockModelList: SiliconCloudModelCard[] = [
        { id: 'Qwen/Qwen2.5-7B-Instruct' },
        { id: 'deepseek-ai/DeepSeek-V3' },
        { id: 'Pro/THUDM/glm-4.5' },
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
