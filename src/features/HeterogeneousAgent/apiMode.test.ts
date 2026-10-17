import { isHeterogeneousProviderBindingSupported } from '@lobechat/heterogeneous-agents';
import { describe, expect, it } from 'vitest';

import { supportsHeterogeneousApiMode } from './apiMode';

describe('supportsHeterogeneousApiMode', () => {
  it.each(['opencode', 'droid'])(
    'offers %s server-default models without enabling user-provider credentials',
    (agentType) => {
      expect(isHeterogeneousProviderBindingSupported(agentType)).toBe(false);
      expect(supportsHeterogeneousApiMode(agentType)).toBe(true);
    },
  );

  it('retains existing bindings and excludes agents with no API transport', () => {
    expect(supportsHeterogeneousApiMode('claude-code')).toBe(true);
    expect(supportsHeterogeneousApiMode('amp')).toBe(false);
  });
});
