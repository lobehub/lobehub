import { computeAgentMailSignature } from '@lobechat/agent-address-mail';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { claimWebhookEvent, releaseWebhookEvent } = vi.hoisted(() => ({
  claimWebhookEvent: vi.fn(),
  releaseWebhookEvent: vi.fn(),
}));
vi.mock('@/server/services/redis', () => ({
  redisService: { agentIdentity: { claimWebhookEvent, releaseWebhookEvent } },
}));

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
    vi.stubEnv('LINQ_API_KEY', '');

    const { createDefaultAgentAccountRegistry } = await loadProviders();

    expect(createDefaultAgentAccountRegistry().list()).toEqual([]);
  });

  it('registers only the provider whose key is present', async () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');
    vi.stubEnv('LINQ_API_KEY', '');

    const { createDefaultAgentAccountRegistry } = await loadProviders();
    const registry = createDefaultAgentAccountRegistry();

    expect(registry.list().map((provider) => provider.provider)).toEqual(['agent-mail']);
    expect(registry.capabilities('agent-mail')).toEqual({ receive: true, send: true });
  });

  it('registers linq when its key is present and declares the phone capability', async () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', '');
    vi.stubEnv('LINQ_API_KEY', 'linq_test');

    const { createDefaultAgentAccountRegistry } = await loadProviders();
    const registry = createDefaultAgentAccountRegistry();

    expect(registry.list().map((provider) => provider.provider)).toEqual(['linq']);
    expect(registry.get('linq').kind).toBe('phone');
  });

  it('builds an explicit registry from injected config, independent of env', async () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', '');

    const { createAgentAccountRegistry } = await loadProviders();
    const registry = createAgentAccountRegistry({
      agentMail: { apiKey: 'am_injected' },
      linq: undefined,
    });

    expect(registry.list().map((provider) => provider.provider)).toEqual(['agent-mail']);
    expect(registry.get('agent-mail')).toMatchObject({
      capabilities: { receive: true, send: true },
      kind: 'mail',
      provider: 'agent-mail',
    });
  });

  it('backs Agent Mail replay claims with the shared Redis store, not per-process memory', async () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');
    claimWebhookEvent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const { createDefaultAgentAccountRegistry } = await loadProviders();
    const provider = createDefaultAgentAccountRegistry().get('agent-mail');
    const body = JSON.stringify({
      createdAt: '2026-10-02T00:00:00.000Z',
      data: { inbox: { address: 'a@lobe.id', clientId: null, id: 'inb_1' }, message: { id: 'm' } },
      id: 'evt_shared',
      type: 'message.received',
    });
    const request = {
      body,
      headers: {
        'x-agentmail-signature': computeAgentMailSignature(
          'whsec',
          body,
          Math.floor(Date.now() / 1000),
        ),
      },
    };
    const ref = {
      credential: { webhookSecret: 'whsec' },
      id: 'acc_1',
      identifier: 'a@lobe.id',
      kind: 'mail' as const,
      metadata: { inboxId: 'inb_1' },
      provider: 'agent-mail',
    };

    // Another instance already accepted this event: Redis says so, and this
    // instance must treat it as a duplicate despite never having seen it.
    await expect(provider.verifyInbound(request, ref)).resolves.not.toHaveProperty('duplicate');
    await expect(provider.verifyInbound(request, ref)).resolves.toMatchObject({ duplicate: true });
    expect(claimWebhookEvent).toHaveBeenCalledWith(
      { eventId: 'evt_shared', provider: 'agent-mail' },
      expect.any(Number),
    );
  });
});
