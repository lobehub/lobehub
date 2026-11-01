import type { AgentAccountProvider } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { AgentAccountProviderRegistry } from '../registry';

/** A provider stub with sensible defaults; only the fields under test differ. */
const stubProvider = (overrides: Partial<AgentAccountProvider> = {}): AgentAccountProvider => ({
  capabilities: { receive: true, send: true },
  kind: 'mail',
  normalizeInbound: async () => null,
  provider: 'stub',
  provision: async () => ({ identifier: 'stub@lobe.id' }),
  release: async () => {},
  resolveInboundIdentifier: () => undefined,
  send: async () => ({ providerMessageId: 'm1' }),
  verifyInbound: async () => null,
  ...overrides,
});

describe('AgentAccountProviderRegistry', () => {
  it('resolves a registered provider by its provider id', () => {
    const registry = new AgentAccountProviderRegistry().register(stubProvider());

    expect(registry.has('stub')).toBe(true);
    expect(registry.get('stub').provider).toBe('stub');
    expect(registry.list()).toHaveLength(1);
  });

  it('refuses to register two providers under the same id', () => {
    const registry = new AgentAccountProviderRegistry().register(stubProvider());

    expect(() => registry.register(stubProvider())).toThrow(/already registered/);
  });

  it('fails an unknown provider with the list of registered ones', () => {
    const registry = new AgentAccountProviderRegistry().register(
      stubProvider({ provider: 'agent-mail' }),
    );

    expect(() => registry.get('linq')).toThrow(
      /Unknown agent account provider "linq".*agent-mail/s,
    );
  });

  it('says no provider is configured when the registry is empty', () => {
    expect(() => new AgentAccountProviderRegistry().get('linq')).toThrow(
      /no identity provider is configured/,
    );
  });

  it('reports the capability declaration of a provider', () => {
    const registry = new AgentAccountProviderRegistry().register(
      stubProvider({ capabilities: { receive: true, send: false } }),
    );

    expect(registry.capabilities('stub')).toEqual({ receive: true, send: false });
  });

  it('filters providers by the account kind they issue', () => {
    const registry = new AgentAccountProviderRegistry()
      .register(stubProvider({ provider: 'agent-mail', kind: 'mail' }))
      .register(stubProvider({ provider: 'linq', kind: 'phone' }));

    expect(registry.listByKind('phone').map((p) => p.provider)).toEqual(['linq']);
    expect(registry.listByKind('mail').map((p) => p.provider)).toEqual(['agent-mail']);
    expect(registry.listByKind('wallet')).toEqual([]);
  });
});
