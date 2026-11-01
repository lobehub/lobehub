import {
  discoverAuthorizationServerMetadata,
  IssuerMismatchError,
} from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as OauthModule from './oauth';
import { refreshConnectorToken } from './oauth';
import { refreshExpiredConnectorTokens } from './tokens';

vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  discoverAuthorizationServerMetadata: vi.fn(),
}));
vi.mock('./oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof OauthModule>()),
  refreshConnectorToken: vi.fn(),
}));

const NOW = 1_800_000_000_000;

const oauthConnector = (id: string, expiresAt: number) =>
  ({
    credentials: { accessToken: `old-${id}`, expiresAt, refreshToken: 'refresh', type: 'oauth2' },
    id,
    identifier: id,
    isEnabled: true,
    mcpServerUrl: 'https://mcp.example.com/mcp',
    oidcConfig: { clientId: 'client', issuer: 'https://auth.example.com' },
  }) as any;

describe('refreshExpiredConnectorTokens', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each([
    new TypeError('network unavailable'),
    new IssuerMismatchError('metadata', 'https://as', 'https://other'),
  ])(
    'keeps credentials and reloads a concurrent rotation after discovery failure: %s',
    async (error) => {
      const expired = oauthConnector('discovery-failed', NOW - 1000);
      const findById = vi.fn().mockResolvedValue(expired);
      vi.mocked(discoverAuthorizationServerMetadata).mockRejectedValueOnce(error);
      const pending = refreshExpiredConnectorTokens([expired], { findById } as any);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual([expired]);
      expect(findById).toHaveBeenCalledTimes(2);
    },
  );

  // Agent runs baked the stored (expired) token into manifests, so
  // the first call after every expiry 401'd even when it was refreshable.
  it('refreshes an expired token and persists the rotated credentials', async () => {
    vi.mocked(refreshConnectorToken).mockResolvedValue({
      tokens: { access_token: 'new-token', expires_in: 3600, token_type: 'Bearer' },
    } as any);
    const update = vi.fn();

    const [connector] = await refreshExpiredConnectorTokens([oauthConnector('xmind', NOW - 1000)], {
      update,
    } as any);

    expect(connector.credentials).toMatchObject({ accessToken: 'new-token' });
    expect(update).toHaveBeenCalledWith(
      'xmind',
      expect.objectContaining({ tokenExpiresAt: new Date(NOW + 3_600_000) }),
    );
  });

  it('leaves a valid token alone without contacting the authorization server', async () => {
    const valid = oauthConnector('valid', NOW + 3_600_000);

    const result = await refreshExpiredConnectorTokens([valid], { update: vi.fn() } as any);

    expect(result).toEqual([valid]);
    expect(discoverAuthorizationServerMetadata).not.toHaveBeenCalled();
  });

  it('skips disabled connectors, which never reach the manifests', async () => {
    const disabled = { ...oauthConnector('disabled', NOW - 1000), isEnabled: false };

    const result = await refreshExpiredConnectorTokens([disabled], { update: vi.fn() } as any);

    expect(result).toEqual([disabled]);
    expect(discoverAuthorizationServerMetadata).not.toHaveBeenCalled();
  });

  it('does not refresh a token whose expiry is unknown', async () => {
    const unknown = oauthConnector('unknown-expiry', NOW);
    delete unknown.credentials.expiresAt;

    const result = await refreshExpiredConnectorTokens([unknown], { update: vi.fn() } as any);

    expect(result).toEqual([unknown]);
    expect(discoverAuthorizationServerMetadata).not.toHaveBeenCalled();
  });

  it('keeps the stored credentials when the authorization server hangs', async () => {
    vi.mocked(refreshConnectorToken).mockReturnValue(new Promise(() => {}));
    const expired = oauthConnector('slow', NOW - 1000);

    const onTimeout = vi.fn();

    const pending = refreshExpiredConnectorTokens([expired], { update: vi.fn() } as any, {
      onTimeout,
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toEqual([expired]);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('retries on a later run after a refresh hung past the timeout', async () => {
    vi.mocked(refreshConnectorToken).mockReturnValue(new Promise(() => {}));
    const expired = oauthConnector('hung', NOW - 1000);
    const model = { update: vi.fn() } as any;

    const first = refreshExpiredConnectorTokens([expired], model);
    await vi.advanceTimersByTimeAsync(5000);
    await first;

    vi.mocked(refreshConnectorToken).mockResolvedValue({
      tokens: { access_token: 'recovered', expires_in: 3600, token_type: 'Bearer' },
    } as any);
    const [connector] = await refreshExpiredConnectorTokens([expired], model);

    expect(refreshConnectorToken).toHaveBeenCalledTimes(2);
    expect(connector.credentials).toMatchObject({ accessToken: 'recovered' });
  });

  it('keeps the stored credentials when the refresh is rejected', async () => {
    vi.mocked(refreshConnectorToken).mockRejectedValue(new Error('invalid_grant'));
    const expired = oauthConnector('revoked', NOW - 1000);
    const findById = vi.fn().mockResolvedValue(expired);

    const pending = refreshExpiredConnectorTokens([expired], { findById, update: vi.fn() } as any);
    await vi.advanceTimersByTimeAsync(1000);

    expect(await pending).toEqual([expired]);
  });

  it('spends the refresh token once for concurrent runs on one instance', async () => {
    vi.mocked(refreshConnectorToken).mockResolvedValue({
      tokens: { access_token: 'new-token', expires_in: 3600, token_type: 'Bearer' },
    } as any);
    const model = { update: vi.fn() } as any;
    const expired = oauthConnector('shared', NOW - 1000);

    const [[first], [second]] = await Promise.all([
      refreshExpiredConnectorTokens([expired], model),
      refreshExpiredConnectorTokens([expired], model),
    ]);

    expect(refreshConnectorToken).toHaveBeenCalledTimes(1);
    expect(first.credentials).toMatchObject({ accessToken: 'new-token' });
    expect(second.credentials).toMatchObject({ accessToken: 'new-token' });
  });

  it('uses the token another instance rotated when its own refresh loses the race', async () => {
    vi.mocked(refreshConnectorToken).mockRejectedValue(new Error('invalid_grant'));
    const expired = oauthConnector('raced', NOW - 1000);
    const rotated = {
      ...expired,
      credentials: { accessToken: 'winner', expiresAt: NOW + 3_600_000, type: 'oauth2' },
    };

    const [connector] = await refreshExpiredConnectorTokens([expired], {
      findById: vi.fn().mockResolvedValue(rotated),
      update: vi.fn(),
    } as any);

    expect(connector.credentials).toMatchObject({ accessToken: 'winner' });
  });

  it('waits for a winner that is still persisting the rotated token', async () => {
    vi.mocked(refreshConnectorToken).mockRejectedValue(new Error('invalid_grant'));
    const expired = oauthConnector('persisting', NOW - 1000);
    const rotated = {
      ...expired,
      credentials: { accessToken: 'winner', expiresAt: NOW + 3_600_000, type: 'oauth2' },
    };
    const findById = vi.fn().mockResolvedValueOnce(expired).mockResolvedValueOnce(rotated);

    const pending = refreshExpiredConnectorTokens([expired], { findById, update: vi.fn() } as any);
    await vi.advanceTimersByTimeAsync(1000);

    expect((await pending)[0].credentials).toMatchObject({ accessToken: 'winner' });
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('uses a rotated token whose authorization server omitted an expiry', async () => {
    vi.mocked(refreshConnectorToken).mockRejectedValue(new Error('invalid_grant'));
    const expired = oauthConnector('no-expiry', NOW - 1000);
    const rotated = { ...expired, credentials: { accessToken: 'winner', type: 'oauth2' } };

    const [connector] = await refreshExpiredConnectorTokens([expired], {
      findById: vi.fn().mockResolvedValue(rotated),
      update: vi.fn(),
    } as any);

    expect(connector.credentials).toMatchObject({ accessToken: 'winner' });
  });
});
