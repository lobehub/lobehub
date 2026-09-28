import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeContext, runCheck } from '../testUtils';
import { endpointChecks } from './endpoints';

const settings = vi.hoisted(() => ({ value: null as any }));

vi.mock('../../settings', () => ({
  loadSettings: () => settings.value,
  normalizeUrl: (url?: string) => (url ? url.replace(/\/$/, '') : undefined),
  resolveAgentGatewayUrl: () => process.env.AGENT_GATEWAY_URL || 'wss://agent-gateway.lobehub.com',
  resolveServerUrl: () => process.env.LOBEHUB_SERVER || 'https://app.lobehub.com',
}));

vi.mock('../../constants/urls', () => ({
  OFFICIAL_AGENT_GATEWAY_URL: 'wss://agent-gateway.lobehub.com',
  OFFICIAL_GATEWAY_URL: 'wss://gateway.lobehub.com',
  OFFICIAL_SERVER_URL: 'https://app.lobehub.com',
}));

describe('endpoints.resolution', () => {
  beforeEach(() => {
    settings.value = null;
    delete process.env.LOBEHUB_SERVER;
    delete process.env.AGENT_GATEWAY_URL;
  });

  it('reports each URL with the source it came from', async () => {
    const outcome = await runCheck(endpointChecks, 'endpoints.resolution');

    expect(outcome.status).toBe('ok');
    expect(outcome.evidence).toMatchObject({
      gatewaySource: 'built-in default',
      serverSource: 'built-in default',
      serverUrl: 'https://app.lobehub.com',
    });
  });

  it('warns — never fails — about a self-hosted server on the official device gateway', async () => {
    process.env.LOBEHUB_SERVER = 'https://lobe.internal';

    const outcome = await runCheck(endpointChecks, 'endpoints.resolution');

    // A failure here would skip every server-side check through the dependency
    // chain, leaving an API-only installation undiagnosable.
    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('device gateway is still the official');
  });

  it('warns when the gateway is on localhost but the server is not', async () => {
    settings.value = { gatewayUrl: 'http://127.0.0.1:8788' };

    const outcome = await runCheck(endpointChecks, 'endpoints.resolution');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('not on the same side of localhost');
  });

  it('warns when a self-hosted server still streams agents from the official gateway', async () => {
    process.env.LOBEHUB_SERVER = 'https://lobe.internal';
    settings.value = { gatewayUrl: 'wss://gateway.internal' };

    const outcome = await runCheck(endpointChecks, 'endpoints.resolution');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('agent streaming');
  });
});

describe('endpoints.tls', () => {
  beforeEach(() => {
    delete process.env.NODE_EXTRA_CA_CERTS;
    delete process.env.HTTPS_PROXY;
  });

  it('fails when NODE_EXTRA_CA_CERTS points at a missing file', async () => {
    process.env.NODE_EXTRA_CA_CERTS = '/nope/missing-ca.pem';

    const outcome = await runCheck(endpointChecks, 'endpoints.tls');

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('does not exist');
  });

  it('reports a proxy without treating it as a problem', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.internal:3128';

    const outcome = await runCheck(endpointChecks, 'endpoints.tls');

    expect(outcome.status).toBe('ok');
    expect(outcome.detail).toContain('proxy via HTTPS_PROXY');
  });

  it('strips the credentials out of an authenticated proxy URL', async () => {
    process.env.HTTPS_PROXY = 'http://alice:hunter2@proxy.internal:3128';

    const outcome = await runCheck(endpointChecks, 'endpoints.tls');
    const serialized = JSON.stringify(outcome.evidence);

    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('alice');
    expect(serialized).toContain('proxy.internal:3128');
  });
});

describe('endpoints.reachable', () => {
  it('turns a DNS failure into a DNS-specific next step', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND lobe.internal'));

    const outcome = await runCheck(endpointChecks, 'endpoints.reachable', makeContext());

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('DNS');
    fetchSpy.mockRestore();
  });

  it('flags a 5xx as a server problem rather than a CLI one', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      headers: new Headers(),
      json: async () => ({}),
      status: 503,
    } as unknown as Response);

    const outcome = await runCheck(endpointChecks, 'endpoints.reachable', makeContext());

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('503');
    fetchSpy.mockRestore();
  });
});
