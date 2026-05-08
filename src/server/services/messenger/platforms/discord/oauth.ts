import { getMessengerDiscordConfig } from '@/config/messenger';

import type {
  MessengerPlatformOAuthAdapter,
  NormalizedInstallation,
  OAuthBuildAuthorizeUrlParams,
  OAuthExchangeCodeParams,
} from '../types';

const DISCORD_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * Scopes requested at install. Combines the bot install (`bot` +
 * `applications.commands`, which trigger the "add to server" picker and
 * register slash commands) with the user-scope `identify` so the callback
 * can resolve who installed the app and persist it on the install row.
 *
 * `identify` is a low-friction scope on Discord — no app verification
 * required, no email exposure, just the user's id / username / avatar.
 * Adding more user-scope features later (e.g. `email`, `guilds`) requires
 * Discord's verification process once the bot crosses 100 servers, so we
 * keep the surface narrow until product asks for it.
 */
const DISCORD_BOT_SCOPES = ['bot', 'applications.commands', 'identify'];

/**
 * Bitfield permissions requested at install. Matches Slack v1's DM-only
 * footprint where possible:
 *
 *   - VIEW_CHANNEL          (1 << 10)   — see channels the bot is added to
 *   - SEND_MESSAGES         (1 << 11)   — outbound replies
 *   - SEND_MESSAGES_IN_THREADS (1 << 38)
 *   - CREATE_PUBLIC_THREADS (1 << 34)   — start a thread on @mention
 *   - READ_MESSAGE_HISTORY  (1 << 16)   — fetch context for replies
 *   - ADD_REACTIONS         (1 << 6)    — 👀/✅ acks, mirrors Slack
 *   - USE_APPLICATION_COMMANDS (1 << 31)
 *
 * Discord exposes these as decimal in the authorize URL.
 */
const DISCORD_BOT_PERMISSIONS = [6, 10, 11, 16, 31, 34, 38]
  .reduce((acc, bit) => acc | (BigInt(1) << BigInt(bit)), BigInt(0))
  .toString();

interface DiscordTokenResponse {
  access_token?: string;
  application?: { id: string };
  error?: string;
  error_description?: string;
  expires_in?: number;
  guild?: { icon: string | null; id: string; name: string };
  refresh_token?: string;
  scope?: string;
  token_type?: 'Bearer';
}

interface DiscordUserResponse {
  avatar?: string | null;
  global_name?: string | null;
  id: string;
  username?: string;
}

const getAppConfig = async (): Promise<{ clientId: string; clientSecret: string } | null> => {
  const config = await getMessengerDiscordConfig();
  // `clientSecret` is required for the `oauth2/token` exchange. Without it
  // the install endpoint returns a 503 with operator-facing copy ("configure
  // Discord client_secret in dc-center → Agent → System Bots"). Bot runtime
  // still works without `clientSecret` because dispatch uses `botToken`, but
  // the audit-trail / user-identity install flow needs the exchange.
  if (!config?.clientSecret) return null;
  return { clientId: config.applicationId, clientSecret: config.clientSecret };
};

const buildAuthorizeUrl = (params: OAuthBuildAuthorizeUrlParams): string => {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DISCORD_BOT_SCOPES.join(' '));
  url.searchParams.set('permissions', DISCORD_BOT_PERMISSIONS);
  url.searchParams.set('state', params.state);
  return url.toString();
};

/**
 * Standard Discord OAuth2 code-grant: POST `oauth2/token`, parse the response
 * (which carries `guild` for `bot`-scope installs and `access_token` for
 * user-scope), then call `/users/@me` to capture the installer's identity.
 *
 * Throws on any required-field gap so the callback maps to a clean
 * `?discord_error=...` redirect.
 */
const exchangeCode = async (params: OAuthExchangeCodeParams): Promise<NormalizedInstallation> => {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });

  const tokenResponse = await fetch(DISCORD_TOKEN_URL, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  if (!tokenResponse.ok) {
    throw new Error(`oauth2/token HTTP ${tokenResponse.status}: ${await tokenResponse.text()}`);
  }
  const data = (await tokenResponse.json()) as DiscordTokenResponse;
  if (data.error) {
    throw new Error(`oauth2/token failed: ${data.error_description ?? data.error}`);
  }
  if (!data.access_token) throw new Error('missing_token');

  const tenantId = data.guild?.id;
  if (!tenantId) throw new Error('missing_tenant');

  // Identify the installer via `/users/@me` (gated behind the `identify`
  // scope we just acquired). Best-effort — if Discord rejects the call we
  // still persist the install with `installedByPlatformUserId: null`; the
  // takeover guard in the callback then falls back to "owned by whoever's
  // session minted the state".
  let installedByPlatformUserId: string | null = null;
  try {
    const userResponse = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (userResponse.ok) {
      const user = (await userResponse.json()) as DiscordUserResponse;
      installedByPlatformUserId = user.id ?? null;
    }
  } catch {
    /* swallow — null is the documented fallback */
  }

  // Application id sits at the OAuth client level, not in `data.application`
  // for every response — `params.clientId` is authoritative.
  const applicationId = data.application?.id ?? params.clientId;

  const credentials: Record<string, unknown> = { accessToken: data.access_token };
  if (data.refresh_token) credentials.refreshToken = data.refresh_token;

  return {
    // Discord's bot user id == application id. The runtime continues to talk
    // to Discord with the global `botToken` from `system_bot_providers`; the
    // per-install user access token persisted here is reserved for messenger
    // user-scope API calls (e.g. listing the installer's guilds).
    accountId: applicationId,
    applicationId,
    credentials,
    installedByPlatformUserId,
    metadata: {
      guildIcon: data.guild?.icon ?? null,
      scope: data.scope ?? DISCORD_BOT_SCOPES.join(' '),
      tenantName: data.guild?.name ?? '',
    },
    tenantId,
    tenantName: data.guild?.name,
    tokenExpiresAt:
      typeof data.expires_in === 'number' ? new Date(Date.now() + data.expires_in * 1000) : null,
  };
};

export const discordOAuthAdapter: MessengerPlatformOAuthAdapter = {
  buildAuthorizeUrl,
  exchangeCode,
  getAppConfig,
};
