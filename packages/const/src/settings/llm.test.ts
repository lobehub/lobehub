import { describe, expect, it, vi } from 'vitest';

import { resolveSubAgentModel } from './llm';

// A build that swaps `@lobechat/business-const` (the cloud one) serves a different
// provider whose catalog does not carry the self-hosted default model id.
vi.mock('@lobechat/business-const', () => ({
  DEFAULT_MINI_MODEL: 'swapped-mini-model',
  DEFAULT_MODEL: 'swapped-default-model',
  DEFAULT_PROVIDER: 'swapped-provider',
}));

describe('resolveSubAgentModel', () => {
  it('falls back to the default model of the same business-const build as the provider', () => {
    expect(resolveSubAgentModel(undefined)).toEqual({
      model: 'swapped-default-model',
      provider: 'swapped-provider',
    });
  });
});
