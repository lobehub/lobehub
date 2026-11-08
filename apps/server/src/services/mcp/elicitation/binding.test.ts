import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpConnectionBinding } from './binding';

beforeEach(() => vi.stubEnv('KEY_VAULTS_SECRET', 'fixture-private-binding-key'));
afterEach(() => vi.unstubAllEnvs());

const oauth = {
  type: 'oauth2',
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
  serverMetadata: {
    issuer: 'https://issuer.example',
    token_endpoint: 'https://issuer.example/token',
  },
  scope: 'read',
  accessToken: 'first',
  refreshToken: 'refresh-first',
  tokenExpiresAt: 1,
};
describe('MCP private continuation binding', () => {
  it('keys the private fingerprint with the server secret and fails closed without it', () => {
    const params = { auth: { type: 'bearer', token: 'fixture-low-entropy' } };
    const first = mcpConnectionBinding(params);
    vi.stubEnv('KEY_VAULTS_SECRET', 'different-server-key');
    expect(mcpConnectionBinding(params)).not.toBe(first);
    vi.stubEnv('KEY_VAULTS_SECRET', undefined);
    expect(() => mcpConnectionBinding(params)).toThrow('required for MCP connection binding');
  });
  it('allows real OAuth token rotation while retaining its non-rotating configuration', () => {
    expect(
      mcpConnectionBinding({
        type: 'http',
        url: 'https://example.com/mcp',
        name: 'slug',
        auth: oauth,
      }),
    ).toBe(
      mcpConnectionBinding({
        name: 'Friendly name',
        url: 'https://example.com/mcp',
        type: 'http',
        headers: undefined,
        auth: {
          ...oauth,
          accessToken: 'rotated',
          refreshToken: 'refresh-rotated',
          tokenExpiresAt: 2,
        },
      }),
    );
    for (const patch of [
      { type: 'bearer' },
      { clientId: 'other' },
      { clientSecret: 'other' },
      { scope: 'write' },
      { serverMetadata: { issuer: 'https://other.example' } },
    ])
      expect(mcpConnectionBinding({ auth: oauth })).not.toBe(
        mcpConnectionBinding({ auth: { ...oauth, ...patch } }),
      );
  });
  it('pins manual bearer, header credentials and OAuth tokens without a real refresh configuration', () => {
    for (const auth of [
      { type: 'bearer', token: 'manual-a' },
      { type: 'oauth2', accessToken: 'manual-a' },
      { type: 'oauth2', accessToken: 'manual-a', refreshToken: 'manual-refresh' },
    ])
      expect(mcpConnectionBinding({ auth })).not.toBe(
        mcpConnectionBinding({ auth: { ...auth, token: 'manual-b', accessToken: 'manual-b' } }),
      );
    for (const name of ['Authorization', 'Proxy-Authorization', 'X-Api-Key']) {
      expect(mcpConnectionBinding({ headers: { [name]: 'fixture-a' } })).not.toBe(
        mcpConnectionBinding({ headers: { [name]: 'fixture-b' } }),
      );
      expect(mcpConnectionBinding({ headers: { [name]: 'fixture-a' } })).toBe(
        mcpConnectionBinding({ headers: { [name.toLowerCase()]: 'fixture-a' } }),
      );
    }
  });
  it('pins endpoint, command, environment and custom tenant headers without exposing credentials', () => {
    const base = {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { tenant: 'alice', Authorization: 'fixture-private' },
    };
    for (const patch of [
      { url: 'https://other.example/mcp' },
      { headers: { tenant: 'bob' } },
      { command: 'other' },
      { env: { USER: 'bob' } },
    ])
      expect(mcpConnectionBinding(base)).not.toBe(mcpConnectionBinding({ ...base, ...patch }));
    expect(mcpConnectionBinding(base)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('retains every credential when header names differ only in case', () => {
    expect(
      mcpConnectionBinding({ headers: { Authorization: 'first', authorization: 'last' } }),
    ).not.toBe(
      mcpConnectionBinding({ headers: { Authorization: 'changed', authorization: 'last' } }),
    );
  });
});
