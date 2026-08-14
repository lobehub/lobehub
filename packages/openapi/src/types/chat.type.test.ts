import { describe, expect, it } from 'vitest';

import {
  ChatServiceParamsSchema,
  MessageGenerationParamsSchema,
  TranslateServiceParamsSchema,
} from './chat.type';

describe('ChatServiceParamsSchema', () => {
  const message = { content: 'Hello', role: 'user' as const };

  it('preserves supported model parameters', () => {
    const result = ChatServiceParamsSchema.parse({
      frequency_penalty: -0.5,
      messages: [message],
      presence_penalty: 0.5,
      stream: false,
      top_p: 0.8,
    });

    expect(result).toMatchObject({
      frequency_penalty: -0.5,
      presence_penalty: 0.5,
      stream: false,
      top_p: 0.8,
    });
  });

  // `n` never reached ChatStreamPayload and this endpoint returns a single content
  // string, so accepting it would promise multiple choices and deliver one.
  it('does not accept a multi-choice n parameter', () => {
    const result = ChatServiceParamsSchema.parse({ messages: [message], n: 2 });

    expect(result).not.toHaveProperty('n');
  });

  it('rejects streaming because /chat returns a JSON envelope', () => {
    const result = ChatServiceParamsSchema.safeParse({ messages: [message], stream: true });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('/responses');
  });

  it('rejects unbounded input arrays', () => {
    const result = ChatServiceParamsSchema.safeParse({
      messages: Array.from({ length: 1001 }, () => message),
    });

    expect(result.success).toBe(false);
  });
});

describe('Chat helper schemas', () => {
  it('requires translation text and target language', () => {
    expect(TranslateServiceParamsSchema.safeParse({ text: '', to: 'zh-CN' }).success).toBe(false);
    expect(TranslateServiceParamsSchema.safeParse({ text: 'Hello', to: 'zh-CN' }).success).toBe(
      true,
    );
  });

  it('requires a user message for reply generation', () => {
    const result = MessageGenerationParamsSchema.safeParse({
      conversationHistory: [],
      sessionId: null,
      userMessage: '',
    });

    expect(result.success).toBe(false);
  });
});
