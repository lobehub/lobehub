// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discordOAuthAdapter } from './oauth';

vi.mock('@/config/messenger', () => ({
  getMessengerDiscordConfig: vi.fn(),
}));

const { getMessengerDiscordConfig } = await import('@/config/messenger');

const VALID_CONFIG = {
  applicationId: 'app-id-1',
  botToken: 'discord-bot-token',
  clientSecret: 'client-secret-1',
  publicKey: 'pk',
};

beforeEach(() => {
  vi.mocked(getMessengerDiscordConfig).mockResolvedValue(VALID_CONFIG as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('discordOAuthAdapter.getAppConfig', () => {
  it('returns clientId/clientSecret when both are configured', async () => {
    const cfg = await discordOAuthAdapter.getAppConfig();
    expect(cfg).toEqual({ clientId: 'app-id-1', clientSecret: 'client-secret-1' });
  });

  it('returns null when discord is not configured', async () => {
    vi.mocked(getMessengerDiscordConfig).mockResolvedValueOnce(null);
    expect(await discordOAuthAdapter.getAppConfig()).toBeNull();
  });

  it('returns null when clientSecret is missing — install endpoint must 503', async () => {
    vi.mocked(getMessengerDiscordConfig).mockResolvedValueOnce({
      applicationId: 'app-id-1',
      botToken: 't',
    } as any);
    expect(await discordOAuthAdapter.getAppConfig()).toBeNull();
  });
});

describe('discordOAuthAdapter.buildAuthorizeUrl', () => {
  it('builds the canonical Discord authorize URL with bot scopes + permissions + state', () => {
    const raw = discordOAuthAdapter.buildAuthorizeUrl({
      clientId: 'app-id-1',
      redirectUri: 'https://app.example.com/cb',
      state: 'nonce-1',
    });

    const url = new URL(raw);
    expect(url.origin + url.pathname).toBe('https://discord.com/api/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('app-id-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/cb');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['bot', 'applications.commands', 'identify']),
    );
    expect(url.searchParams.get('state')).toBe('nonce-1');
    // Permissions bitfield must include the documented bits — check two
    // bookend bits (ADD_REACTIONS=64 and SEND_MESSAGES_IN_THREADS=2^38).
    const perms = BigInt(url.searchParams.get('permissions') ?? '0');
    expect(perms & (1n << 6n)).toBe(1n << 6n); // ADD_REACTIONS
    expect(perms & (1n << 38n)).toBe(1n << 38n); // SEND_MESSAGES_IN_THREADS
  });
});

describe('discordOAuthAdapter.exchangeCode', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const okTokenResponse = (overrides: Record<string, unknown> = {}) =>
    new Response(
      JSON.stringify({
        access_token: 'access-token-1',
        application: { id: 'app-id-1' },
        expires_in: 3600,
        guild: { icon: 'icon-hash', id: 'guild-1', name: 'My Guild' },
        refresh_token: 'refresh-token-1',
        scope: 'bot applications.commands identify',
        token_type: 'Bearer',
        ...overrides,
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    );

  const okUserResponse = (id = 'user-installer-1') =>
    new Response(JSON.stringify({ id, username: 'tester' }), { status: 200 });

  it('exchanges the code, fetches /users/@me, and normalizes the install', async () => {
    fetchSpy.mockResolvedValueOnce(okTokenResponse() as any);
    fetchSpy.mockResolvedValueOnce(okUserResponse() as any);

    const result = await discordOAuthAdapter.exchangeCode({
      clientId: 'app-id-1',
      clientSecret: 'client-secret-1',
      code: 'the-code',
      redirectUri: 'https://app.example.com/cb',
    });

    expect(result.tenantId).toBe('guild-1');
    expect(result.tenantName).toBe('My Guild');
    expect(result.applicationId).toBe('app-id-1');
    expect(result.accountId).toBe('app-id-1');
    expect(result.installedByPlatformUserId).toBe('user-installer-1');
    expect(result.credentials).toEqual({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
    });
    expect(result.metadata).toEqual({
      guildIcon: 'icon-hash',
      scope: 'bot applications.commands identify',
      tenantName: 'My Guild',
    });
    expect(result.tokenExpiresAt).toBeInstanceOf(Date);

    // Token POST goes form-encoded with grant_type=authorization_code.
    const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0] as [string, any];
    expect(tokenUrl).toBe('https://discord.com/api/oauth2/token');
    expect(tokenInit?.method).toBe('POST');
    const body = tokenInit?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('redirect_uri')).toBe('https://app.example.com/cb');

    // /users/@me uses the freshly-minted access token.
    const [userUrl, userInit] = fetchSpy.mock.calls[1] as [string, any];
    expect(userUrl).toBe('https://discord.com/api/v10/users/@me');
    expect((userInit?.headers as any).Authorization).toBe('Bearer access-token-1');
  });

  it('omits refreshToken when Discord did not return one', async () => {
    fetchSpy.mockResolvedValueOnce(okTokenResponse({ refresh_token: undefined }) as any);
    fetchSpy.mockResolvedValueOnce(okUserResponse() as any);

    const result = await discordOAuthAdapter.exchangeCode({
      clientId: 'app-id-1',
      clientSecret: 'client-secret-1',
      code: 'c',
      redirectUri: 'https://r',
    });
    expect((result.credentials as any).refreshToken).toBeUndefined();
  });

  it('falls back to params.clientId for applicationId when response omits application.id', async () => {
    fetchSpy.mockResolvedValueOnce(okTokenResponse({ application: undefined }) as any);
    fetchSpy.mockResolvedValueOnce(okUserResponse() as any);

    const result = await discordOAuthAdapter.exchangeCode({
      clientId: 'app-id-1',
      clientSecret: 'client-secret-1',
      code: 'c',
      redirectUri: 'https://r',
    });
    expect(result.applicationId).toBe('app-id-1');
  });

  it('sets tokenExpiresAt to null when expires_in is absent', async () => {
    fetchSpy.mockResolvedValueOnce(okTokenResponse({ expires_in: undefined }) as any);
    fetchSpy.mockResolvedValueOnce(okUserResponse() as any);

    const result = await discordOAuthAdapter.exchangeCode({
      clientId: 'app-id-1',
      clientSecret: 'client-secret-1',
      code: 'c',
      redirectUri: 'https://r',
    });
    expect(result.tokenExpiresAt).toBeNull();
  });

  it('falls back to installedByPlatformUserId=null when /users/@me fails', async () => {
    fetchSpy.mockResolvedValueOnce(okTokenResponse() as any);
    fetchSpy.mockResolvedValueOnce(new Response('err', { status: 500 }) as any);

    const result = await discordOAuthAdapter.exchangeCode({
      clientId: 'app-id-1',
      clientSecret: 'client-secret-1',
      code: 'c',
      redirectUri: 'https://r',
    });
    expect(result.installedByPlatformUserId).toBeNull();
  });

  it('swallows /users/@me network errors and persists with null installer', async () => {
    fetchSpy.mockResolvedValueOnce(okTokenResponse() as any);
    fetchSpy.mockRejectedValueOnce(new Error('econnreset'));

    const result = await discordOAuthAdapter.exchangeCode({
      clientId: 'app-id-1',
      clientSecret: 'client-secret-1',
      code: 'c',
      redirectUri: 'https://r',
    });
    expect(result.installedByPlatformUserId).toBeNull();
  });

  it('throws when the token endpoint returns non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('upstream', { status: 502 }) as any);
    await expect(
      discordOAuthAdapter.exchangeCode({
        clientId: 'a',
        clientSecret: 'b',
        code: 'c',
        redirectUri: 'd',
      }),
    ).rejects.toThrow(/HTTP 502/);
  });

  it('throws when the token response carries a logical error', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'bad code' }), {
        status: 200,
      }) as any,
    );
    await expect(
      discordOAuthAdapter.exchangeCode({
        clientId: 'a',
        clientSecret: 'b',
        code: 'c',
        redirectUri: 'd',
      }),
    ).rejects.toThrow(/bad code/);
  });

  it('throws missing_token when access_token is absent', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ guild: { id: 'g' } }), { status: 200 }) as any,
    );
    await expect(
      discordOAuthAdapter.exchangeCode({
        clientId: 'a',
        clientSecret: 'b',
        code: 'c',
        redirectUri: 'd',
      }),
    ).rejects.toThrow('missing_token');
  });

  it('throws missing_tenant when guild.id is absent (e.g. user-only install)', async () => {
    fetchSpy.mockResolvedValueOnce(okTokenResponse({ guild: undefined }) as any);
    await expect(
      discordOAuthAdapter.exchangeCode({
        clientId: 'a',
        clientSecret: 'b',
        code: 'c',
        redirectUri: 'd',
      }),
    ).rejects.toThrow('missing_tenant');
  });
});
