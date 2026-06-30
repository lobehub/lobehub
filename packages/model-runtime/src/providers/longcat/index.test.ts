// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeLongCatAI } from './index';

testProvider({
  Runtime: LobeLongCatAI,
  provider: ModelProvider.LongCat,
  defaultBaseURL: 'https://api.longcat.chat/openai/v1',
  chatDebugEnv: 'DEBUG_LONGCAT_CHAT_COMPLETION',
  chatModel: 'LongCat-Flash-Lite',
  test: {
    skipAPICall: true,
  },
});

let instance: InstanceType<typeof LobeLongCatAI>;

beforeEach(() => {
  instance = new LobeLongCatAI({ apiKey: 'test' });

  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeLongCatAI - custom features', () => {
  describe('handlePayload', () => {
    it('should call API with corresponding options', async () => {
      // Arrange
      const mockStream = new ReadableStream();
      const mockResponse = Promise.resolve(mockStream);

      (instance['client'].chat.completions.create as any).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        max_tokens: 1024,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'LongCat-2.0',
        temperature: 0.7,
        stream: true,
        top_p: 1,
      });

      // Assert
      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        {
          frequency_penalty: undefined,
          max_tokens: 1024,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'LongCat-2.0',
          presence_penalty: undefined,
          stream: true,
          stream_options: {
            include_usage: true,
          },
          temperature: 0.35,
          top_p: 1,
        },
        { headers: { Accept: '*/*' } },
      );
      expect(result).toBeInstanceOf(Response);
    });

    it('should normalize temperature - 0 stays 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'LongCat-2.0',
        temperature: 0,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0);
    });

    it('should normalize temperature by halving it', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'LongCat-2.0',
        temperature: 0.5,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.25);
    });

    it('should normalize temperature to 1 when it is 2', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'LongCat-2.0',
        temperature: 2,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(1);
    });

    it('should normalize temperature with undefined value', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'LongCat-2.0',
        temperature: undefined,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBeUndefined();
    });

    it('should pass thinking object with enabled type when thinking is enabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'LongCat-2.0',
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
    });

    it('should pass thinking object with disabled type when thinking is disabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'LongCat-2.0',
        thinking: { type: 'disabled' },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'disabled' });
    });

    it('should not pass thinking object when thinking is undefined', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'LongCat-2.0',
        thinking: undefined,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toBeUndefined();
    });
  });
});
