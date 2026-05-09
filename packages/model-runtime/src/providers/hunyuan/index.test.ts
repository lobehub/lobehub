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
  chatModel: 'hunyuan-role-latest',
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
        model: 'hunyuan-role-latest',
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
        model: 'hunyuan-role-latest',
        messages: [{ role: 'user', content: 'test' }],
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        temperature: 0.7,
      } as any;

      const result = handlePayload(payload);

      expect(result.frequency_penalty).toBeUndefined();
      expect(result.presence_penalty).toBeUndefined();
      expect(result.model).toBe('hunyuan-role-latest');
      expect(result.temperature).toBe(0.7);
    });

    it('should preserve thinking type in payload', () => {
      const payload = {
        model: 'deepseek-v3.2',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' },
      } as any;

      const result = handlePayload(payload);

      expect(result.thinking).toEqual({ type: 'enabled' });
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

    it('should add search fields when enabledSearch is true', () => {
      const payload = {
        model: 'hunyuan-2.0-thinking-20251109',
        messages: [{ role: 'user', content: 'test' }],
        enabledSearch: true,
      } as any;

      const result = handlePayload(payload);

      expect(result.citation).toBe(true);
      expect(result.enable_enhancement).toBe(true);
      expect(result.search_info).toBe(true);
      expect(result.enable_speed_search).toBe(false);
      expect(result.enabledSearch).toBeUndefined();
    });

    it('should respect HUNYUAN_ENABLE_SPEED_SEARCH env when search is enabled', () => {
      process.env.HUNYUAN_ENABLE_SPEED_SEARCH = '1';

      const payload = {
        model: 'hunyuan-2.0-thinking-20251109',
        messages: [{ role: 'user', content: 'test' }],
        enabledSearch: true,
      } as any;

      const result = handlePayload(payload);

      expect(result.enable_speed_search).toBe(true);

      delete process.env.HUNYUAN_ENABLE_SPEED_SEARCH;
    });

    it('should not add search fields when enabledSearch is false', () => {
      const payload = {
        model: 'hunyuan-2.0-thinking-20251109',
        messages: [{ role: 'user', content: 'test' }],
        enabledSearch: false,
      } as any;

      const result = handlePayload(payload);

      expect(result.citation).toBeUndefined();
      expect(result.enable_enhancement).toBeUndefined();
      expect(result.search_info).toBeUndefined();
      expect(result.enable_speed_search).toBeUndefined();
    });
  });
});
