import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCheck } from '../testUtils';
import { credentialChecks } from './credentials';

const source = vi.hoisted(() => ({ value: {} as any }));
const credential = vi.hoisted(() => ({ value: {} as any }));
const serverVersion = vi.hoisted(() => ({ value: {} as any }));

vi.mock('../../auth/source', () => ({
  maskSecret: (token?: string) => (token ? `…${token.slice(-4)}` : 'none'),
  pickAuthSource: () => source.value,
}));

vi.mock('../probes', () => ({
  probeCredential: async () => credential.value,
  probeServerVersion: async () => serverVersion.value,
}));

describe('credentials.source', () => {
  beforeEach(() => {
    source.value = { kind: 'stored', origin: 'stored login', token: 'abcd1234', tokenType: 'jwt' };
  });

  it('fails when nothing is available to authenticate with', async () => {
    source.value = { kind: 'stored', origin: 'stored login', tokenType: 'jwt' };

    const outcome = await runCheck(credentialChecks, 'credentials.source');

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('login');
  });

  it('warns that an inherited LOBEHUB_JWT outranks the stored login', async () => {
    source.value = { kind: 'env-jwt', origin: 'LOBEHUB_JWT', token: 'x.y.zzzz', tokenType: 'jwt' };

    const outcome = await runCheck(credentialChecks, 'credentials.source');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('not with the stored login');
  });

  it('never prints the credential itself', async () => {
    const outcome = await runCheck(credentialChecks, 'credentials.source');

    expect(outcome.detail).not.toContain('abcd1234');
    expect(JSON.stringify(outcome.evidence)).not.toContain('abcd1234');
  });
});

describe('credentials.validity', () => {
  it('reports why an API key was rejected', async () => {
    credential.value = {
      error: 'Request failed with status 401.',
      kind: 'env-api-key',
      origin: 'LOBEHUB_CLI_API_KEY',
      tokenType: 'apiKey',
    };

    const outcome = await runCheck(credentialChecks, 'credentials.validity');

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('LOBEHUB_CLI_API_KEY');
  });

  /**
   * The probe knows a refresh timed out and says so; the check used to print its own generic
   * "log in again" underneath, so doctor gave two contradictory instructions at once.
   */
  it("keeps the probe's own remedy instead of prescribing a fresh login", async () => {
    credential.value = {
      error:
        'Could not reach the server to refresh the access token: fetch failed. The stored login is untouched, so this is the network or the server rather than a signed-out session.',
      fix: 'Retry in a moment; the stored login does not need renewing.',
      kind: 'stored',
      origin: 'stored login',
      tokenType: 'jwt',
    };

    const outcome = await runCheck(credentialChecks, 'credentials.validity');

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('Retry in a moment');
    expect(outcome.fix).not.toMatch(/run .*login/i);
  });

  it('fails an expired token that could not refresh', async () => {
    credential.value = {
      expiresAt: Math.floor(Date.now() / 1000) - 600,
      kind: 'stored',
      origin: 'stored login',
      tokenType: 'jwt',
      userId: 'user_1',
    };

    const outcome = await runCheck(credentialChecks, 'credentials.validity');

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('expired');
  });

  it('warns when the token is about to expire mid-command', async () => {
    credential.value = {
      expiresAt: Math.floor(Date.now() / 1000) + 120,
      kind: 'stored',
      origin: 'stored login',
      tokenType: 'jwt',
      userId: 'user_1',
    };

    const outcome = await runCheck(credentialChecks, 'credentials.validity');

    expect(outcome.status).toBe('warn');
  });

  it('accepts an API key that carries no subject', async () => {
    credential.value = { kind: 'env-api-key', origin: 'LOBEHUB_CLI_API_KEY', tokenType: 'apiKey' };

    const outcome = await runCheck(credentialChecks, 'credentials.validity');

    expect(outcome.status).toBe('ok');
  });
});

describe('credentials.clock', () => {
  it('fails on skew large enough to break token validation', async () => {
    serverVersion.value = {
      dateHeader: new Date(Date.now() - 600_000).toUTCString(),
      latencyMs: 20,
    };

    const outcome = await runCheck(credentialChecks, 'credentials.clock');

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('time sync');
  });

  it('passes when the clocks agree', async () => {
    serverVersion.value = { dateHeader: new Date().toUTCString(), latencyMs: 20 };

    const outcome = await runCheck(credentialChecks, 'credentials.clock');

    expect(outcome.status).toBe('ok');
  });
});
