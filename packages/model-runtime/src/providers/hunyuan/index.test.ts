// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeHunyuanAI, params } from './index';

testProvider({
  Runtime: LobeHunyuanAI,
  provider: ModelProvider.Hunyuan,
  defaultBaseURL: 'https://tokenhub.tencentmaas.com/v1',
  chatDebugEnv: 'DEBUG_HUNYUAN_CHAT_COMPLETION',
  chatModel: 'hunyuan-lite',
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeHunyuanAI({ apiKey: 'test' });

  // 使用 vi.spyOn 来模拟 chat.completions.create 方法
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

describe('LobeHunyuanAI', () => {
  describe('chat', () => {
    it('should return a StreamingTextResponse on a Hunyuan chat call', async () => {
      const mockStream = new ReadableStream();
      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(mockStream as any);

      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'hunyuan-lite',
        temperature: 0,
      });

      expect(result).toBeInstanceOf(Response);
    });
  });
});

describe('LobeHunyuanAI - custom features', () => {
  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_HUNYUAN_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_HUNYUAN_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_HUNYUAN_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    const handlePayload = params.chatCompletion.handlePayload!;

    it('should remove frequency_penalty and presence_penalty from payload', () => {
      const payload = {
        model: 'hunyuan-lite',
        messages: [{ role: 'user', content: 'test' }],
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        temperature: 0.7,
      } as any;

      const result = handlePayload(payload);

      expect(result.frequency_penalty).toBeUndefined();
      expect(result.presence_penalty).toBeUndefined();
      expect(result.model).toBe('hunyuan-lite');
      expect(result.temperature).toBe(0.7);
    });

    it('should transform reasoning to reasoning_content for hy3-preview assistant messages', () => {
      const payload = {
        model: 'hy3-preview',
        messages: [
          {
            role: 'assistant',
            content: 'answer',
            reasoning: { content: 'reasoning text' },
          },
          {
            role: 'user',
            content: 'prompt',
          },
        ],
      } as any;

      const result = handlePayload(payload);

      expect(result.messages).toEqual([
        {
          role: 'assistant',
          content: 'answer',
          reasoning_content: 'reasoning text',
        },
        {
          role: 'user',
          content: 'prompt',
        },
      ]);
    });
  });
});
