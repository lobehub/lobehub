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

/** A run-scoped model whose rows are all in its own scope (`forRow` is itself). */
const runModel = (methods: Record<string, unknown>) => {
  const model: Record<string, unknown> = { ...methods };
  model.forRow = () => model;
  return model as any;
};

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
      const pending = refreshExpiredConnectorTokens([expired], runModel({ findById }));
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

    const [connector] = await refreshExpiredConnectorTokens(
      [oauthConnector('xmind', NOW - 1000)],
      runModel({ update }),
    );

    expect(connector.credentials).toMatchObject({ accessToken: 'new-token' });
    expect(update).toHaveBeenCalledWith(
      'xmind',
      expect.objectContaining({ tokenExpiresAt: new Date(NOW + 3_600_000) }),
    );
  });

  it('leaves a valid token alone without contacting the authorization server', async () => {
    const valid = oauthConnector('valid', NOW + 3_600_000);

    const result = await refreshExpiredConnectorTokens([valid], runModel({ update: vi.fn() }));

    expect(result).toEqual([valid]);
    expect(discoverAuthorizationServerMetadata).not.toHaveBeenCalled();
  });

  it('skips disabled connectors, which never reach the manifests', async () => {
    const disabled = { ...oauthConnector('disabled', NOW - 1000), isEnabled: false };

    const result = await refreshExpiredConnectorTokens([disabled], runModel({ update: vi.fn() }));

    expect(result).toEqual([disabled]);
    expect(discoverAuthorizationServerMetadata).not.toHaveBeenCalled();
  });

  it('does not refresh a token whose expiry is unknown', async () => {
    const unknown = oauthConnector('unknown-expiry', NOW);
    delete unknown.credentials.expiresAt;

    const result = await refreshExpiredConnectorTokens([unknown], runModel({ update: vi.fn() }));

    expect(result).toEqual([unknown]);
    expect(discoverAuthorizationServerMetadata).not.toHaveBeenCalled();
  });

  it('keeps the stored credentials when the authorization server hangs', async () => {
    vi.mocked(refreshConnectorToken).mockReturnValue(new Promise(() => {}));
    const expired = oauthConnector('slow', NOW - 1000);

    const onTimeout = vi.fn();

    const pending = refreshExpiredConnectorTokens([expired], runModel({ update: vi.fn() }), {
      onTimeout,
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toEqual([expired]);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('retries on a later run after a refresh hung past the timeout', async () => {
    vi.mocked(refreshConnectorToken).mockReturnValue(new Promise(() => {}));
    const expired = oauthConnector('hung', NOW - 1000);
    const model = runModel({ update: vi.fn() });

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

    const pending = refreshExpiredConnectorTokens(
      [expired],
      runModel({ findById, update: vi.fn() }),
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(await pending).toEqual([expired]);
  });

  it('spends the refresh token once for concurrent runs on one instance', async () => {
    vi.mocked(refreshConnectorToken).mockResolvedValue({
      tokens: { access_token: 'new-token', expires_in: 3600, token_type: 'Bearer' },
    } as any);
    const model = runModel({ update: vi.fn() });
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

    const [connector] = await refreshExpiredConnectorTokens(
      [expired],
      runModel({ findById: vi.fn().mockResolvedValue(rotated), update: vi.fn() }),
    );

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

    const pending = refreshExpiredConnectorTokens(
      [expired],
      runModel({ findById, update: vi.fn() }),
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect((await pending)[0].credentials).toMatchObject({ accessToken: 'winner' });
    expect(findById).toHaveBeenCalledTimes(2);
  });

  // A private agent's workspace run resolves its owner's personal connector;
  // the workspace-scoped model cannot write that row, so a rotated refresh
  // token must go through the row's own scope or it is lost.
  it("persists the rotated token through the connector's own scope", async () => {
    vi.mocked(refreshConnectorToken).mockResolvedValue({
      tokens: { access_token: 'new-token', expires_in: 3600, token_type: 'Bearer' },
    } as any);
    const personal = { ...oauthConnector('personal-gmail', NOW - 1000), workspaceId: null };
    const homeModel = { update: vi.fn() };
    const runUpdate = vi.fn();
    const forRow = vi.fn().mockReturnValue(homeModel);

    const [connector] = await refreshExpiredConnectorTokens([personal], {
      forRow,
      update: runUpdate,
    } as any);

    expect(connector.credentials).toMatchObject({ accessToken: 'new-token' });
    expect(forRow).toHaveBeenCalledWith(personal);
    expect(homeModel.update).toHaveBeenCalledWith(
      'personal-gmail',
      expect.objectContaining({ tokenExpiresAt: new Date(NOW + 3_600_000) }),
    );
    expect(runUpdate).not.toHaveBeenCalled();
  });

  it('uses a rotated token whose authorization server omitted an expiry', async () => {
    vi.mocked(refreshConnectorToken).mockRejectedValue(new Error('invalid_grant'));
    const expired = oauthConnector('no-expiry', NOW - 1000);
    const rotated = { ...expired, credentials: { accessToken: 'winner', type: 'oauth2' } };

    const [connector] = await refreshExpiredConnectorTokens(
      [expired],
      runModel({ findById: vi.fn().mockResolvedValue(rotated), update: vi.fn() }),
    );

    expect(connector.credentials).toMatchObject({ accessToken: 'winner' });
  });
});
