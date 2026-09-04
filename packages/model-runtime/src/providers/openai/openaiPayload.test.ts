import { describe, expect, it } from 'vitest';

import { params } from './index';

describe('OpenAI payload handlers', () => {
  // handlePayload only forces the Responses API for models that have no
  // chat/completions endpoint. Models that merely *prefer* it are routed by
  // shouldUseResponsesAPI() in the factory, which honors the user's
  // `enableResponseApi` toggle — see the `instance.chat()` coverage in index.test.ts.
  it.each(['o1-pro', 'codex-mini-latest', 'gpt-5-pro', 'gpt-5.5-pro', 'gpt-5.1-codex-mini'])(
    'should force %s through the Responses API',
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

  it.each(['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'should leave the API mode of %s to the factory',
    (model) => {
      const result = params.chatCompletion.handlePayload({
        messages: [{ content: 'Hello', role: 'user' }],
        model,
        temperature: 0.7,
      });

      expect(result).toMatchObject({ model });
      expect(result.apiMode).toBeUndefined();
    },
  );

  it.each(['gpt-5.6', 'gpt-5.6-sol'])(
    'should preserve the apiMode the factory already resolved for %s',
    (model) => {
      const result = params.chatCompletion.handlePayload({
        apiMode: 'responses',
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
