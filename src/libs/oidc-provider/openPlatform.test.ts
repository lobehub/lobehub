/**
 * @vitest-environment node
 */
import { getTestDB } from '@lobechat/database/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { users } from '@/database/schemas';

vi.mock('@/envs/auth', () => ({ authEnv: {} }));

const {
  createRegistrationOwnerPolicy,
  getOpenPlatformFlags,
  issueRegistrationToken,
  oauthTokenApiScopes,
  openPlatformScopes,
} = await import('./openPlatform');

const off = {
  apiScopes: false,
  clientCredentials: false,
  dynamicRegistration: false,
  registrationApproval: false,
};

describe('getOpenPlatformFlags', () => {
  it('is all off by default', () => {
    expect(getOpenPlatformFlags({} as any)).toEqual(off);
  });

  it('keeps client_credentials off until API scopes bound what a machine token can do', () => {
    expect(getOpenPlatformFlags({ OIDC_ENABLE_CLIENT_CREDENTIALS: true } as any)).toEqual(off);
    expect(
      getOpenPlatformFlags({
        OIDC_ENABLE_API_SCOPES: true,
        OIDC_ENABLE_CLIENT_CREDENTIALS: true,
      } as any),
    ).toMatchObject({ apiScopes: true, clientCredentials: true });
  });

  it('only offers API scopes once switched on, never full access', () => {
    expect(openPlatformScopes(off)).toEqual([]);
    const scopes = openPlatformScopes({ ...off, apiScopes: true });
    expect(scopes).toContain('agent:read');
    expect(scopes).toContain('agent:credential:write');
    expect(scopes).not.toContain('*');
  });
});

describe('oauthTokenApiScopes', () => {
  it('keeps first-party and settings-created sign-ins without API scopes unrestricted', () => {
    expect(
      oauthTokenApiScopes({
        clientCredentials: false,
        clientId: 'lobehub-desktop',
        scope: 'openid profile offline_access',
      }),
    ).toBeUndefined();
    expect(
      oauthTokenApiScopes({ clientCredentials: false, clientId: 'lca_app', scope: 'openid' }),
    ).toBeUndefined();
  });

  it('narrows any token that carries API scopes to them', () => {
    expect(
      oauthTokenApiScopes({
        clientCredentials: false,
        clientId: 'lca_app',
        scope: 'openid agent:read chat:write',
      }),
    ).toEqual(['agent:read', 'chat:write']);
  });

  it('narrows dynamically registered clients and machine tokens even with no API scope', () => {
    expect(
      oauthTokenApiScopes({ clientCredentials: false, clientId: 'lcd_partner', scope: 'openid' }),
    ).toEqual([]);
    expect(
      oauthTokenApiScopes({ clientCredentials: true, clientId: 'lca_app', scope: undefined }),
    ).toEqual([]);
  });
});

describe('registration owner policy', () => {
  const properties = () => ({
    client_name: 'Partner',
    redirect_uris: ['https://partner.example.com/cb'],
  });

  it('starts a client disabled when registrations need approval', async () => {
    const db = await getTestDB();
    await db.insert(users).values({ id: 'user_policy' }).onConflictDoNothing();
    const { token } = await issueRegistrationToken(db, { userId: 'user_policy' });
    const policy = createRegistrationOwnerPolicy(db, { ...off, registrationApproval: true });
    const ctx: any = { oidc: { entities: { InitialAccessToken: { jti: token } } } };

    const metadata: Record<string, unknown> = properties();
    await policy(ctx, metadata);

    expect(metadata).toMatchObject({
      lobehub_owner_user_id: 'user_policy',
      lobehub_pending_approval: true,
    });
    // single use
    await expect(policy(ctx, properties())).rejects.toMatchObject({
      error: 'invalid_token',
      error_detail: expect.stringMatching(/already used/),
    });
  });

  it('refuses a registration that presented no initial access token', async () => {
    const db = await getTestDB();
    await db.insert(users).values({ id: 'user_policy' }).onConflictDoNothing();
    const policy = createRegistrationOwnerPolicy(db, off);
    const ctx: any = { oidc: { entities: {} } };

    await expect(policy(ctx, properties())).rejects.toMatchObject({ error: 'invalid_token' });
  });
});
