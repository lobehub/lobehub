import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The deployment wiring: env key present ⇒ provider registered, absent ⇒ the
 * provider is omitted entirely (rather than registered broken). Reloaded per
 * test because the registry reads the env once at module load.
 */
const loadProviders = async () => {
  vi.resetModules();
  return import('../providers');
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('createDefaultAgentAccountRegistry', () => {
  it('registers nothing when no provider key is configured', async () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', '');

    const { createDefaultAgentAccountRegistry } = await loadProviders();

    expect(createDefaultAgentAccountRegistry().list()).toEqual([]);
  });

  it('registers agent-mail when its key is present', async () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');

    const { createDefaultAgentAccountRegistry } = await loadProviders();
    const registry = createDefaultAgentAccountRegistry();

    expect(registry.list().map((provider) => provider.provider)).toEqual(['agent-mail']);
    expect(registry.capabilities('agent-mail')).toEqual({ receive: true, send: true });
  });

  it('builds an explicit registry from injected config, independent of env', async () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', '');

    const { createAgentAccountRegistry } = await loadProviders();
    const registry = createAgentAccountRegistry({
      agentMail: { apiKey: 'am_injected' },
    });

    expect(registry.list().map((provider) => provider.provider)).toEqual(['agent-mail']);
    expect(registry.get('agent-mail')).toMatchObject({
      capabilities: { receive: true, send: true },
      kind: 'mail',
      provider: 'agent-mail',
    });
  });
});
