import { randomBytes } from 'node:crypto';

import { apiScopesFromOAuthScope, OAUTH_API_SCOPES } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { MAX_OAUTH_REDIRECT_URIS, validateRedirectUri } from '@lobechat/utils/oauthApp';
import debug from 'debug';
import { and, eq, sql } from 'drizzle-orm';
import type { Configuration, KoaContextWithOIDC } from 'oidc-provider';
import { errors } from 'oidc-provider';

import { oidcAccessTokens, oidcClients } from '@/database/schemas';
import { authEnv } from '@/envs/auth';

const log = debug('lobe-oidc:open-platform');

/**
 * OAuth open platform: dynamic client registration (RFC 7591), the
 * `client_credentials` grant, and API key scopes offered as OAuth scopes.
 *
 * Every capability sits behind its own server switch and is off by default.
 * `client_credentials` additionally needs API scopes: a machine token has no
 * user to consent for it, so the scopes its client registered are the only
 * thing that bounds it.
 */
export interface OpenPlatformFlags {
  apiScopes: boolean;
  clientCredentials: boolean;
  dynamicRegistration: boolean;
  registrationApproval: boolean;
}

export const getOpenPlatformFlags = (env: typeof authEnv = authEnv): OpenPlatformFlags => ({
  apiScopes: !!env.OIDC_ENABLE_API_SCOPES,
  clientCredentials: !!env.OIDC_ENABLE_CLIENT_CREDENTIALS && !!env.OIDC_ENABLE_API_SCOPES,
  dynamicRegistration: !!env.OIDC_ENABLE_DYNAMIC_REGISTRATION,
  registrationApproval: !!env.OIDC_DYNAMIC_REGISTRATION_REQUIRE_APPROVAL,
});

/** Scopes added to the provider's catalog on top of the OIDC ones. */
export const openPlatformScopes = (flags: OpenPlatformFlags): string[] =>
  flags.apiScopes ? [...OAUTH_API_SCOPES] : [];

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Client ids minted by dynamic registration; settings-created apps use `lca_`. */
export const DYNAMIC_CLIENT_ID_PREFIX = 'lcd_';

export const isDynamicClientId = (clientId?: string | null): boolean =>
  !!clientId && clientId.startsWith(DYNAMIC_CLIENT_ID_PREFIX);

const randomToken = (bytes: number) => randomBytes(bytes).toString('base64url');

export const generateDynamicClientId = () => `${DYNAMIC_CLIENT_ID_PREFIX}${randomToken(18)}`;

export const generateDynamicClientSecret = () => `lcs_${randomToken(32)}`;

/** The registration policy every initial access token carries. */
export const REGISTRATION_OWNER_POLICY = 'lobehub-owner';

/**
 * Client metadata the owner policy stamps onto a registration. They are
 * overwritten unconditionally, so a registrant sending them gains nothing; the
 * adapter turns them into the row's owner and enabled columns.
 */
export const CLIENT_OWNER_USER_METADATA = 'lobehub_owner_user_id';
export const CLIENT_OWNER_WORKSPACE_METADATA = 'lobehub_owner_workspace_id';
export const CLIENT_PENDING_APPROVAL_METADATA = 'lobehub_pending_approval';

export const OPEN_PLATFORM_CLIENT_METADATA = [
  CLIENT_OWNER_USER_METADATA,
  CLIENT_OWNER_WORKSPACE_METADATA,
  CLIENT_PENDING_APPROVAL_METADATA,
];

/** `client_id` column value of initial access token rows (the column is NOT NULL). */
export const REGISTRATION_TOKEN_CLIENT_ID = 'urn:lobehub:registration';

/** Access token claims naming who a `client_credentials` token acts as. */
export const CLIENT_CREDENTIALS_OWNER_CLAIM = 'lobehub_owner';
export const CLIENT_CREDENTIALS_WORKSPACE_CLAIM = 'lobehub_workspace';

// ---------------------------------------------------------------------------
// Initial access tokens
// ---------------------------------------------------------------------------

export const REGISTRATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Issues a single-use initial access token that lets its bearer register one
 * client owned by `userId` (and `workspaceId` when given).
 *
 * The row is written directly instead of through `provider.InitialAccessToken`
 * because the provider's token payload has nowhere to keep an owner; the
 * owner lives in the row's `user_id` column and in `data`, which the owner
 * policy reads back when the token is presented.
 */
export const issueRegistrationToken = async (
  db: LobeChatDatabase,
  {
    expiresIn = REGISTRATION_TOKEN_TTL_SECONDS,
    userId,
    workspaceId,
  }: { expiresIn?: number; userId: string; workspaceId?: string | null },
) => {
  const token = randomToken(32);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresIn;

  await db.insert(oidcAccessTokens).values({
    clientId: REGISTRATION_TOKEN_CLIENT_ID,
    data: {
      exp,
      iat,
      jti: token,
      kind: 'InitialAccessToken',
      lobehubWorkspaceId: workspaceId ?? null,
      policies: [REGISTRATION_OWNER_POLICY],
    },
    expiresAt: new Date(exp * 1000),
    id: token,
    userId,
  });

  return { expiresAt: new Date(exp * 1000), token };
};

/**
 * Burns an initial access token and returns its owner. The delete is the
 * check, so two registrations racing on one token cannot both get an owner.
 */
export const consumeRegistrationToken = async (db: LobeChatDatabase, token: string) => {
  const [row] = await db
    .delete(oidcAccessTokens)
    .where(
      and(
        eq(oidcAccessTokens.id, token),
        eq(oidcAccessTokens.clientId, REGISTRATION_TOKEN_CLIENT_ID),
        sql`${oidcAccessTokens.data}->>'kind' = 'InitialAccessToken'`,
      ),
    )
    .returning({ data: oidcAccessTokens.data, userId: oidcAccessTokens.userId });

  if (!row) return undefined;

  const workspaceId = (row.data as { lobehubWorkspaceId?: string | null }).lobehubWorkspaceId;

  return { userId: row.userId, workspaceId: workspaceId ?? null };
};

// ---------------------------------------------------------------------------
// Registration rules
// ---------------------------------------------------------------------------

const OIDC_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);

const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

const CONFIDENTIAL_AUTH_METHODS = new Set(['client_secret_basic', 'client_secret_post']);

/**
 * Metadata the provider would fetch from, or call, a registrant-chosen URL:
 * remote key sets, sector identifiers, request objects and back-channel logout.
 * Each one is an outbound request from our servers to an address a stranger
 * picked, so registration refuses them rather than vetting the address.
 */
const SERVER_FETCHED_METADATA = [
  'backchannel_logout_uri',
  'jwks',
  'jwks_uri',
  'request_uris',
  'sector_identifier_uri',
];

const DISPLAY_URI_METADATA = ['client_uri', 'logo_uri', 'policy_uri', 'tos_uri'];

const MAX_CLIENT_NAME_LENGTH = 64;

type Metadata = Record<string, unknown>;

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : value === undefined ? [] : [String(value)];

const assertRedirectUris = (uris: string[], field: string) => {
  if (uris.length > MAX_OAUTH_REDIRECT_URIS) {
    throw new errors.InvalidClientMetadata(
      `${field} must not list more than ${MAX_OAUTH_REDIRECT_URIS} entries`,
    );
  }

  for (const uri of uris) {
    const issue = validateRedirectUri(uri);
    if (!issue) continue;

    const description = `${field} entry is not allowed (${issue}): ${uri}`;
    if (field !== 'redirect_uris') throw new errors.InvalidClientMetadata(description);

    // InvalidRedirectUri carries a fixed description written for the
    // authorization endpoint; a registrant needs to know which entry and why.
    throw Object.assign(new errors.InvalidRedirectUri(), { error_description: description });
  }
};

/**
 * What a dynamically registered client may declare. oidc-provider still runs
 * its own metadata validation afterwards; these are the rules specific to a
 * self-service registration from an unknown party.
 */
export const assertRegistrationMetadata = (properties: Metadata, flags: OpenPlatformFlags) => {
  const name = properties.client_name;
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_CLIENT_NAME_LENGTH) {
    throw new errors.InvalidClientMetadata(
      `client_name is required and must be at most ${MAX_CLIENT_NAME_LENGTH} characters`,
    );
  }

  for (const field of SERVER_FETCHED_METADATA) {
    if (properties[field] !== undefined) {
      throw new errors.InvalidClientMetadata(`${field} is not supported for registered clients`);
    }
  }

  for (const field of DISPLAY_URI_METADATA) {
    const value = properties[field];
    if (value === undefined) continue;
    let protocol: string | undefined;
    try {
      protocol = new URL(String(value)).protocol;
    } catch {
      // handled below
    }
    if (protocol !== 'https:') throw new errors.InvalidClientMetadata(`${field} must be https`);
  }

  assertRedirectUris(asList(properties.redirect_uris), 'redirect_uris');
  assertRedirectUris(asList(properties.post_logout_redirect_uris), 'post_logout_redirect_uris');

  // oidc-provider defaults these when absent; mirror its defaults so the rules
  // below judge what will actually be stored.
  const grantTypes = properties.grant_types
    ? asList(properties.grant_types)
    : ['authorization_code'];
  const authMethod = String(properties.token_endpoint_auth_method ?? 'client_secret_basic');

  if (authMethod !== 'none' && !CONFIDENTIAL_AUTH_METHODS.has(authMethod)) {
    throw new errors.InvalidClientMetadata(
      'token_endpoint_auth_method must be none, client_secret_basic or client_secret_post',
    );
  }

  const allowedGrants = new Set(['authorization_code', 'refresh_token', DEVICE_CODE_GRANT]);
  if (flags.clientCredentials) allowedGrants.add('client_credentials');

  for (const grant of grantTypes) {
    if (!allowedGrants.has(grant)) {
      throw new errors.InvalidClientMetadata(`grant_types value is not allowed: ${grant}`);
    }
  }

  // A public client has no secret, so "authenticating as the client" would be
  // possible for anyone holding its id.
  if (grantTypes.includes('client_credentials') && !CONFIDENTIAL_AUTH_METHODS.has(authMethod)) {
    throw new errors.InvalidClientMetadata(
      'client_credentials requires a confidential client (client_secret_basic or client_secret_post)',
    );
  }

  const allowedScopes = new Set([...OIDC_SCOPES, ...openPlatformScopes(flags)]);
  const scopes = typeof properties.scope === 'string' ? properties.scope.split(' ') : [];
  for (const scope of scopes.filter(Boolean)) {
    if (!allowedScopes.has(scope)) {
      throw new errors.InvalidClientMetadata(`scope value is not allowed: ${scope}`);
    }
  }

  if (
    grantTypes.includes('client_credentials') &&
    apiScopesFromOAuthScope(scopes.join(' ')).length === 0
  ) {
    throw new errors.InvalidClientMetadata(
      'a client_credentials client must register the API scopes it needs in scope',
    );
  }
};

/**
 * The policy attached to every initial access token: binds the registration to
 * the token's owner, applies the registration rules, and burns the token.
 */
export const createRegistrationOwnerPolicy =
  (db: LobeChatDatabase, flags: OpenPlatformFlags) =>
  async (ctx: KoaContextWithOIDC, properties: Metadata) => {
    // Without a registered scope oidc-provider lets the client ask for any
    // scope in the catalog, and the consent page would list API capabilities
    // the token can never receive. A client that wants them registers them.
    if (properties.scope === undefined) properties.scope = [...OIDC_SCOPES].join(' ');

    // Checked before the token is burned, so a rejected payload can be fixed
    // and resent. oidc-provider's own validation runs after the policy; a
    // payload it rejects does cost the token.
    assertRegistrationMetadata(properties, flags);

    const jti = (ctx.oidc.entities as { InitialAccessToken?: { jti: string } }).InitialAccessToken
      ?.jti;
    const owner = jti ? await consumeRegistrationToken(db, jti) : undefined;
    if (!owner) throw new errors.InvalidToken('initial access token is invalid or already used');

    properties[CLIENT_OWNER_USER_METADATA] = owner.userId;
    properties[CLIENT_OWNER_WORKSPACE_METADATA] = owner.workspaceId ?? undefined;
    properties[CLIENT_PENDING_APPROVAL_METADATA] = flags.registrationApproval;

    log('registration bound to user %s workspace %s', owner.userId, owner.workspaceId);
  };

export const createRegistrationFeature = (
  db: LobeChatDatabase,
  flags: OpenPlatformFlags,
): NonNullable<Configuration['features']>['registration'] => ({
  enabled: flags.dynamicRegistration,
  idFactory: generateDynamicClientId,
  initialAccessToken: true,
  // Management (RFC 7592) would need a token row with no user; owners manage
  // registered apps from the settings page instead.
  issueRegistrationAccessToken: false,
  policies: { [REGISTRATION_OWNER_POLICY]: createRegistrationOwnerPolicy(db, flags) },
  secretFactory: generateDynamicClientSecret,
});

export const openPlatformClientMetadata = (): Configuration['extraClientMetadata'] => ({
  properties: OPEN_PLATFORM_CLIENT_METADATA,
});

/**
 * The owner stamps are internal: keep the owner's user and workspace ids out
 * of the registration response a third party reads.
 */
export const stripOpenPlatformMetadata = async (
  ctx: KoaContextWithOIDC,
  next: () => Promise<unknown>,
) => {
  await next();

  if (ctx.oidc?.route !== 'registration' || !ctx.body || typeof ctx.body !== 'object') return;

  for (const key of OPEN_PLATFORM_CLIENT_METADATA) delete (ctx.body as Metadata)[key];
};

// ---------------------------------------------------------------------------
// client_credentials
// ---------------------------------------------------------------------------

export const findClientOwner = async (db: LobeChatDatabase, clientId: string) => {
  const [client] = await db
    .select({
      enabled: oidcClients.enabled,
      userId: oidcClients.userId,
      workspaceId: oidcClients.workspaceId,
    })
    .from(oidcClients)
    .where(eq(oidcClients.id, clientId))
    .limit(1);

  if (!client || client.enabled === false || !client.userId) return undefined;

  return { userId: client.userId, workspaceId: client.workspaceId };
};

/**
 * A `client_credentials` token has no end user: oidc-provider sets its `sub`
 * to the client id. It acts as the user (and workspace) that owns the client,
 * so the owner is resolved when the token is minted and signed into it.
 */
export const createExtraTokenClaims =
  (db: LobeChatDatabase): NonNullable<Configuration['extraTokenClaims']> =>
  async (_ctx, token) => {
    if (token.kind !== 'ClientCredentials') return undefined;

    const owner = token.clientId ? await findClientOwner(db, token.clientId) : undefined;
    if (!owner) throw new errors.InvalidClient('client is disabled or has no owner');

    return {
      [CLIENT_CREDENTIALS_OWNER_CLAIM]: owner.userId,
      ...(owner.workspaceId ? { [CLIENT_CREDENTIALS_WORKSPACE_CLAIM]: owner.workspaceId } : {}),
    };
  };

// ---------------------------------------------------------------------------
// Resource server side
// ---------------------------------------------------------------------------

/**
 * The API key scopes an OAuth access token is limited to, in the shape the
 * public API's scope gates read (`undefined` = not narrowed).
 *
 * A token is narrowed whenever it carries API scopes, and always when it comes
 * from a dynamically registered client or the `client_credentials` grant: those
 * are third parties that only hold what was consented to (or registered), even
 * if that is nothing. Tokens from built-in and settings-created apps that ask
 * for no API scope keep the full access they had before scopes existed.
 */
export const oauthTokenApiScopes = ({
  clientCredentials,
  clientId,
  scope,
}: {
  clientCredentials: boolean;
  clientId?: string | null;
  scope?: string | null;
}): string[] | undefined => {
  const scopes = apiScopesFromOAuthScope(scope);

  if (scopes.length > 0 || clientCredentials || isDynamicClientId(clientId)) return scopes;

  return undefined;
};
