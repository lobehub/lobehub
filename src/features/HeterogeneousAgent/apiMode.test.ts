import { isHeterogeneousProviderBindingSupported } from '@lobechat/heterogeneous-agents';
import { describe, expect, it } from 'vitest';

import { isApiAuthBlockedOnTarget, supportsHeterogeneousApiMode } from './apiMode';

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

describe('isApiAuthBlockedOnTarget', () => {
  it.each(['sandbox', 'device', 'auto', 'none'] as const)(
    'blocks API auth when the agent runs on %s',
    (target) => {
      expect(isApiAuthBlockedOnTarget('api', target)).toBe(true);
    },
  );

  it('allows API auth on this desktop and never blocks subscription auth', () => {
    expect(isApiAuthBlockedOnTarget('api', 'local')).toBe(false);
    expect(isApiAuthBlockedOnTarget('subscription', 'sandbox')).toBe(false);
    expect(isApiAuthBlockedOnTarget(undefined, 'device')).toBe(false);
  });
});
