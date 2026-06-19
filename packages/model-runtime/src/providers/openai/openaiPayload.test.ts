import { describe, expect, it } from 'vitest';

import { params } from './index';

describe('OpenAI payload handlers', () => {
  it('should force future GPT-5 minor models to use Responses API', () => {
    const result = params.chatCompletion.handlePayload({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.6',
      temperature: 0.7,
    });

    expect(result).toMatchObject({
      apiMode: 'responses',
      model: 'gpt-5.6',
    });
  });

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

  it('should normalize future GPT-5 pro reasoning effort to high in Responses payloads', () => {
    const result = params.responses.handlePayload({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.6-pro',
      reasoning: { effort: 'medium' },
      temperature: 0.7,
    });

    expect(result).toMatchObject({
      model: 'gpt-5.6-pro',
      reasoning: { effort: 'high', summary: 'auto' },
    });
  });
});
