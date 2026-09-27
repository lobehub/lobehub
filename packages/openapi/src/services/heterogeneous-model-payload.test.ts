import { describe, expect, it } from 'vitest';

import { prepareServerDefaultChatPayload } from './heterogeneous-model-payload';

const prepare = (
  limits: { contextWindowTokens?: number; maxOutput?: number },
  requested = 262144,
) =>
  prepareServerDefaultChatPayload({
    ...limits,
    agentType: 'kimi-code',
    model: 'new-model',
    supportsAdaptiveThinking: false,
    payload: { model: 'new-model', messages: [], max_tokens: requested },
  });

describe('Kimi output budgets', () => {
  it('defers to provider defaults for missing limits or a full-context output limit', () => {
    expect(prepare({}).max_tokens).toBeUndefined();
    expect(prepare({ maxOutput: 205000, contextWindowTokens: 205000 }).max_tokens).toBeUndefined();
  });
  it('clamps to valid declared limits while preserving a smaller explicit request', () => {
    expect(prepare({ maxOutput: 8192, contextWindowTokens: 65536 }).max_tokens).toBe(8192);
    expect(prepare({ maxOutput: 8192, contextWindowTokens: 65536 }, 2048).max_tokens).toBe(2048);
    expect(prepare({ maxOutput: 205000, contextWindowTokens: 205000 }, 8192).max_tokens).toBe(8192);
  });
});
