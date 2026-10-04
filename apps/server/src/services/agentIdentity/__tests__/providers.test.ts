import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

/**
 * The deployment wiring: env key present ⇒ provider registered, absent ⇒ the
 * provider is omitted entirely (rather than registered broken). Reloaded per
 * test because the registry reads the env once at module load.
 */
const loadProviders = async () => {
  vi.resetModules();
  return import('../providers');
};

/** Registration never touches the database; the number service only keeps it. */
const db = {} as LobeChatDatabase;

const clearEnv = () => {
  vi.stubEnv('AGENT_MAIL_API_KEY', '');
  vi.stubEnv('TWILIO_ACCOUNT_SID', '');
  vi.stubEnv('TWILIO_AUTH_TOKEN', '');
  vi.stubEnv('TELNYX_API_KEY', '');
  vi.stubEnv('TELNYX_PUBLIC_KEY', '');
  vi.stubEnv('TELNYX_MESSAGING_PROFILE_ID', '');
  vi.stubEnv('AGENT_NUMBER_WEBHOOK_BASE_URL', '');
};

// Each test re-imports the provider graph (services, models, env) from scratch.
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('createDefaultAgentAccountRegistry', () => {
  it('registers nothing when no provider key is configured', async () => {
    clearEnv();

    const { createDefaultAgentAccountRegistry } = await loadProviders();

    expect(createDefaultAgentAccountRegistry(db).list()).toEqual([]);
  });

  it('registers only the provider whose key is present', async () => {
    clearEnv();
    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');

    const { createDefaultAgentAccountRegistry } = await loadProviders();
    const registry = createDefaultAgentAccountRegistry(db);

    expect(registry.list().map((provider) => provider.provider)).toEqual(['agent-mail']);
    expect(registry.capabilities('agent-mail')).toEqual({ receive: true, send: true });
  });

  it('registers both carriers as phone providers, Twilio first, receive-only by declaration', async () => {
    clearEnv();
    vi.stubEnv('AGENT_NUMBER_WEBHOOK_BASE_URL', 'https://app.example.com/');
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token');
    vi.stubEnv('TELNYX_API_KEY', 'KEY_test');
    // A valid raw Ed25519 public key (32 bytes, base64) so the adapter can load it.
    vi.stubEnv('TELNYX_PUBLIC_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('TELNYX_MESSAGING_PROFILE_ID', 'mp_test');

    const { createDefaultAgentAccountRegistry, dedicatedNumberSettingsFromEnv } =
      await loadProviders();
    const registry = createDefaultAgentAccountRegistry(db);

    expect(registry.listByKind('phone').map((provider) => provider.provider)).toEqual([
      'twilio',
      'telnyx',
    ]);
    // The ceiling a fresh number gets: receive now, send only once 10DLC is approved.
    expect(registry.capabilities('twilio')).toEqual({ receive: true, send: false });
    expect(dedicatedNumberSettingsFromEnv('twilio').smsWebhookUrl).toBe(
      'https://app.example.com/api/agent/accounts/webhooks/twilio',
    );
  });

  it('does not register a carrier without a public webhook origin', async () => {
    clearEnv();
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token');

    const { createDefaultAgentAccountRegistry } = await loadProviders();

    expect(createDefaultAgentAccountRegistry(db).list()).toEqual([]);
  });

  it('builds an explicit registry from injected config, independent of env', async () => {
    clearEnv();

    const { createAgentAccountRegistry } = await loadProviders();
    const registry = createAgentAccountRegistry({ agentMail: { apiKey: 'am_injected' } });

    expect(registry.list().map((provider) => provider.provider)).toEqual(['agent-mail']);
    expect(registry.get('agent-mail')).toMatchObject({
      capabilities: { receive: true, send: true },
      kind: 'mail',
      provider: 'agent-mail',
    });
  });
});
