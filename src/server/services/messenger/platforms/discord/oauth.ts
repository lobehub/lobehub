import { getMessengerDiscordConfig } from '@/config/messenger';

import type {
  MessengerPlatformOAuthAdapter,
  NormalizedInstallation,
  OAuthBuildAuthorizeUrlParams,
  OAuthExchangeCodeParams,
} from '../types';

const DISCORD_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

/**
 * Bot scopes requested when the user adds the LobeHub bot to a Discord guild.
 * `bot` is the scope that triggers the "add to server" picker; the
 * `permissions` integer narrows what the bot can do once added.
 *
 * `applications.commands` is required for slash commands; we ship them in v1
 * so the bot can register `/lobe ...` commands per guild on first install.
 */
const DISCORD_BOT_SCOPES = ['bot', 'applications.commands'];

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
const DISCORD_BOT_PERMISSIONS = (
  (1n << 6n) |
  (1n << 10n) |
  (1n << 11n) |
  (1n << 16n) |
  (1n << 31n) |
  (1n << 34n) |
  (1n << 38n)
).toString();

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

const getAppConfig = async (): Promise<{ clientId: string; clientSecret: string } | null> => {
  const config = await getMessengerDiscordConfig();
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

const exchangeCode = async (params: OAuthExchangeCodeParams): Promise<NormalizedInstallation> => {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });

  const response = await fetch(DISCORD_TOKEN_URL, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`oauth2/token HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as DiscordTokenResponse;
  if (data.error) {
    throw new Error(`oauth2/token failed: ${data.error_description ?? data.error}`);
  }

  // For `bot` scope installs Discord returns `guild` describing where the bot
  // was added. No `guild` => the user authorised but didn't pick a server,
  // which we can't persist as a per-tenant install row.
  const tenantId = data.guild?.id;
  if (!tenantId) throw new Error('missing_tenant');
  if (!data.access_token) throw new Error('missing_token');

  // Application id sits at the OAuth client level, not in `data.application`
  // for every response — `params.clientId` is authoritative.
  const applicationId = data.application?.id ?? params.clientId;

  const credentials: Record<string, unknown> = { accessToken: data.access_token };
  if (data.refresh_token) credentials.refreshToken = data.refresh_token;

  return {
    // Discord OAuth doesn't expose a separate bot-user id at install time —
    // the bot user shares the application id. The runtime bot continues to
    // call Discord with the global `botToken` from system_bot_providers.
    accountId: applicationId,
    applicationId,
    credentials,
    // Discord doesn't report the user who triggered the install in the bot
    // grant response (would need the `identify` scope + a separate /users/@me
    // call). Leave null for v1.
    installedByPlatformUserId: null,
    metadata: {
      guildIcon: data.guild?.icon ?? null,
      scope: data.scope ?? '',
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
