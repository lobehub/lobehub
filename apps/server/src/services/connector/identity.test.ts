import type { AuthorizationServerMetadata, OAuthTokens } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveLinkIdentity } from './identity';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mocks.fetch }));
const metadata = {
  issuer: 'https://as.example',
  userinfo_endpoint: 'https://as.example/me',
} as AuthorizationServerMetadata;
const tokens = (extra: Record<string, unknown> = {}) =>
  ({ access_token: 'access', token_type: 'Bearer', ...extra }) as OAuthTokens;
afterEach(() => {
  vi.clearAllMocks();
});
describe('resolveLinkIdentity', () => {
  it('uses id token profile before userinfo, with issuer-scoped identity', async () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: 'alice', email: 'alice@example.com', picture: 'https://avatar' }),
    ).toString('base64url');
    expect(
      await resolveLinkIdentity({
        metadata,
        tokens: tokens({ id_token: `header.${payload}.sig` }),
      }),
    ).toEqual({
      externalAccountId: '["https://as.example","alice"]',
      profile: { email: 'alice@example.com', avatar: 'https://avatar' },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('falls back to SSRF-safe userinfo and tolerates no identity', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ sub: 'bob', preferred_username: 'Bob' }));
    expect(
      await resolveLinkIdentity({ metadata, tokens: tokens({ id_token: 'malformed' }) }),
    ).toMatchObject({ profile: { username: 'Bob' } });
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer access');
    mocks.fetch.mockRejectedValueOnce(new Error('blocked'));
    expect(await resolveLinkIdentity({ metadata, tokens: tokens() })).toBeUndefined();
    expect(
      await resolveLinkIdentity({
        metadata: { issuer: 'https://as' } as AuthorizationServerMetadata,
        tokens: tokens(),
      }),
    ).toBeUndefined();
  });
});
