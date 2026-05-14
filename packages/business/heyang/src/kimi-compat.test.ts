import { describe, expect, it } from 'vitest';

import { applyKimiCompat, isKimiNewApi } from './kimi-compat';

describe('kimi-compat', () => {
  it('should only enable compat for NewAPI Kimi models', () => {
    expect(isKimiNewApi('newapi', 'kimi-k2.6')).toBe(true);
    expect(isKimiNewApi('openai', 'kimi-k2.6')).toBe(false);
    expect(isKimiNewApi('newapi', 'gpt-5.5')).toBe(false);
  });

  it('should remove thinking from Kimi NewAPI payloads', () => {
    const payload = applyKimiCompat(
      {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'kimi-k2.6',
        thinking: { budget_tokens: 1024, type: 'enabled' },
      },
      'newapi',
    );

    expect(payload).not.toHaveProperty('thinking');
  });

  it('should preserve complete reasoning content on assistant tool-call history', () => {
    const payload = applyKimiCompat(
      {
        messages: [
          {
            content: '',
            reasoning: { content: 'Need to call the tool first.' },
            role: 'assistant',
            tool_calls: [
              {
                function: { arguments: '{}', name: 'search' },
                id: 'call_1',
                type: 'function',
              },
            ],
          },
        ],
        model: 'kimi-k2.6',
      },
      'newapi',
    );

    expect(payload.messages?.[0]).toEqual(
      expect.objectContaining({
        reasoning_content: 'Need to call the tool first.',
      }),
    );
    expect(payload.messages?.[0]).not.toHaveProperty('reasoning');
  });

  it('should drop incomplete reasoning_content on assistant history', () => {
    const payload = applyKimiCompat(
      {
        messages: [
          {
            content: '',
            reasoning_content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: { arguments: '{}', name: 'search' },
                id: 'call_1',
                type: 'function',
              },
            ],
          },
        ],
        model: 'kimi-k2.6',
      },
      'newapi',
    );

    expect(payload.messages?.[0]).not.toHaveProperty('reasoning_content');
  });

  it('should leave non-Kimi payloads untouched', () => {
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-5.5',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    };

    expect(applyKimiCompat(payload, 'newapi')).toBe(payload);
  });
});
