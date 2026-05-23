import { getMessengerSlackConfig } from '@/config/messenger';

import { buildInstallUrl, exchangeCode as exchangeSlackCode } from '../../oauth/slackOAuth';
import type {
  MessengerPlatformOAuthAdapter,
  NormalizedInstallation,
  OAuthBuildAuthorizeUrlParams,
  OAuthExchangeCodeParams,
} from '../types';

/**
 * Bot scopes requested at install. The Slack App's manifest must declare
 * every scope listed here, otherwise Slack rejects the install with
 * `invalid_scope`.
 *
 * Aligned with the per-agent bot path (`docs/usage/channels/slack.zh-CN.mdx`)
 * so messenger v1 supports the full surface (channel @mention, slash
 * commands, channel/group/DM history, reactions, Slack AI assistant) instead
 * of the narrower DM-only set we shipped initially.
 *
 * Messenger-specific extras kept on top of the per-agent set:
 *   - `im:write` — open a DM with the linker to deliver the account-link
 *     button privately when a slash command is invoked from a public channel
 *   - `users:read.email` — match Slack identity to a LobeHub account during
 *     the link flow
 *
 * `reactions:write` powers the inline feedback in
 * `AgentBridgeService.handleMention` (👀 processing → ✅ done).
 */
const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'assistant:write',
  'channels:history',
  'channels:read',
  'chat:write',
  'commands',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'reactions:read',
  'reactions:write',
  'users:read',
  'users:read.email',
];

const getAppConfig = async (): Promise<{ clientId: string; clientSecret: string } | null> => {
  const config = await getMessengerSlackConfig();
  if (!config) return null;
  return { clientId: config.clientId, clientSecret: config.clientSecret };
};

const buildAuthorizeUrl = (params: OAuthBuildAuthorizeUrlParams): string =>
  buildInstallUrl({
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    scopes: SLACK_BOT_SCOPES,
    state: params.state,
  });

const exchangeCode = async (params: OAuthExchangeCodeParams): Promise<NormalizedInstallation> => {
  const oauth = await exchangeSlackCode(params);

  // Workspace install → team.id; Enterprise Grid org install → enterprise.id.
  const isEnterpriseInstall = oauth.is_enterprise_install === true;
  const tenantId = isEnterpriseInstall ? oauth.enterprise?.id : oauth.team?.id;
  const tenantName = isEnterpriseInstall ? oauth.enterprise?.name : oauth.team?.name;

  if (!tenantId) throw new Error('missing_tenant');
  if (!oauth.access_token) throw new Error('missing_token');
  if (!oauth.app_id) throw new Error('missing_app_id');

  // Token rotation is opt-in per App; presence of `expires_in` + `refresh_token`
  // is what tells us this install is rotating.
  const credentials: Record<string, unknown> = { botToken: oauth.access_token };
  if (oauth.refresh_token) credentials.refreshToken = oauth.refresh_token;

  return {
    accountId: oauth.bot_user_id ?? null,
    applicationId: oauth.app_id,
    credentials,
    installedByPlatformUserId: oauth.authed_user?.id ?? null,
    metadata: {
      enterpriseId: oauth.enterprise?.id ?? null,
      isEnterpriseInstall,
      scope: oauth.scope ?? '',
      tenantName: tenantName ?? '',
    },
    tenantId,
    tenantName,
    tokenExpiresAt:
      typeof oauth.expires_in === 'number' ? new Date(Date.now() + oauth.expires_in * 1000) : null,
  };
};

const buildPostInstallRedirect = (install: NormalizedInstallation): URL | null => {
  // Enterprise Grid installs don't have a single team to deep-link to, so we
  // fall back to the route's default settings redirect.
  if (install.metadata.isEnterpriseInstall) return null;
  const url = new URL('https://slack.com/app/open');
  url.searchParams.set('team', install.tenantId);
  url.searchParams.set('id', install.applicationId);
  return url;
};

export const slackOAuthAdapter: MessengerPlatformOAuthAdapter = {
  buildAuthorizeUrl,
  buildPostInstallRedirect,
  exchangeCode,
  getAppConfig,
};
