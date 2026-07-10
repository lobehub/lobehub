import { describe, expect, it } from 'vitest';

import { params } from './index';

describe('OpenAI payload handlers', () => {
  it.each(['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'should route %s through the Responses API',
    (model) => {
      const result = params.chatCompletion.handlePayload({
        messages: [{ content: 'Hello', role: 'user' }],
        model,
        temperature: 0.7,
      });

      expect(result).toMatchObject({
        apiMode: 'responses',
        model,
      });
    },
  );

  it('should keep GPT-5 chat-latest variants on Chat Completions', () => {
    const result = params.chatCompletion.handlePayload({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.2-chat-latest',
      temperature: 0.7,
    });

    expect(result).toMatchObject({
      model: 'gpt-5.2-chat-latest',
    });
    expect(result.apiMode).toBeUndefined();
  });

  it('should normalize GPT-5 Pro reasoning effort to high in Responses payloads', () => {
    const result = params.responses.handlePayload({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5-pro',
      reasoning: { effort: 'medium' },
      temperature: 0.7,
    });

    expect(result).toMatchObject({
      model: 'gpt-5.5-pro',
      reasoning: { effort: 'high', summary: 'auto' },
    });
  });
});
