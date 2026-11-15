import { describe, expect, it } from 'vitest';

import { coerceJsonPrompt } from './heteroPrompt';

describe('coerceJsonPrompt', () => {
  it('reads a plain string or content blocks as the prompt', () => {
    expect(coerceJsonPrompt('hi')).toEqual({ prompt: 'hi' });
    expect(coerceJsonPrompt([{ text: 'hi', type: 'text' }])).toEqual({
      prompt: [{ text: 'hi', type: 'text' }],
    });
  });

  it("keeps the dispatch envelope's agent env apart from the prompt", () => {
    expect(
      coerceJsonPrompt({
        agentEnv: { ANTHROPIC_BASE_URL: 'https://proxy.example.com', NOT_A_STRING: 42 },
        content: [{ text: 'hi', type: 'text' }],
        resumeFallback: [{ text: 'history', type: 'text' }],
      }),
    ).toEqual({
      agentEnv: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
      prompt: [{ text: 'hi', type: 'text' }],
      resumeFallbackPrompt: [{ text: 'history', type: 'text' }],
    });
  });

  it('drops an agent env that is not a string map', () => {
    expect(
      coerceJsonPrompt({ agentEnv: ['A=1'], content: [{ text: 'hi', type: 'text' }] }),
    ).toEqual({ prompt: [{ text: 'hi', type: 'text' }] });
  });

  it('rejects a shape that carries no prompt', () => {
    expect(() => coerceJsonPrompt({ agentEnv: { A: '1' } })).toThrow(/Invalid --input-json/);
  });
});
