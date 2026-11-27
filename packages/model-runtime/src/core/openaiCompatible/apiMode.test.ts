import { describe, expect, it } from 'vitest';

import { shouldUseResponsesAPI } from './apiMode';

describe('shouldUseResponsesAPI', () => {
  it('routes models OpenAI only serves on Responses to Responses by default', () => {
    expect(shouldUseResponsesAPI({ model: 'gpt-6.2-sol' }, 'test')).toBe(true);
  });

  it('keeps every model on Chat Completions when the endpoint has no Responses API', () => {
    expect(
      shouldUseResponsesAPI({ model: 'gpt-6.2-sol', responsesApiUnsupported: true }, 'test'),
    ).toBe(false);
    expect(
      shouldUseResponsesAPI(
        {
          flagUseResponse: true,
          model: 'gpt-5.5',
          responseApi: true,
          responsesApiUnsupported: true,
          userApiMode: 'responses',
        },
        'test',
      ),
    ).toBe(false);
  });

  it('leaves other models on Chat Completions without any flag', () => {
    expect(shouldUseResponsesAPI({ model: 'claude-sonnet-5-5' }, 'test')).toBe(false);
  });
});
