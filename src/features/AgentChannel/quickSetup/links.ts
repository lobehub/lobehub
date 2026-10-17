/**
 * Deep links that pre-fill a platform's own developer console, so creating a
 * bot app takes one click instead of a page of settings.
 */

export const TELEGRAM_BOTFATHER_URL = 'https://t.me/BotFather';
export const DISCORD_DEVELOPER_PORTAL_URL = 'https://discord.com/developers/applications';
export const SLACK_APPS_URL = 'https://api.slack.com/apps';
export const FEISHU_CONSOLE_URL = {
  feishu: 'https://open.feishu.cn/app',
  lark: 'https://open.larksuite.com/app',
} as const;
export const QQ_BOT_CONSOLE_URL = 'https://q.qq.com/qqbot/';
export const LINE_CONSOLE_URL = 'https://developers.line.biz/console/';

/**
 * What the bot needs in a server: view channels, send messages (also in
 * threads), embed links, attach files, read history, add reactions, create
 * public threads.
 */
const DISCORD_PERMISSION_BITS = [10, 11, 14, 15, 16, 6, 35, 38];

export const DISCORD_BOT_PERMISSIONS = DISCORD_PERMISSION_BITS.reduce(
  (total, bit) => total | (1n << BigInt(bit)),
  0n,
).toString();

/** Invite link that adds the bot to a server with exactly the permissions above. */
export const buildDiscordInviteUrl = (applicationId: string) => {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', applicationId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', DISCORD_BOT_PERMISSIONS);
  return url.toString();
};

export const buildDiscordBotPageUrl = (applicationId: string) =>
  `${DISCORD_DEVELOPER_PORTAL_URL}/${encodeURIComponent(applicationId)}/bot`;

/** Slack's bot user name allows lowercase letters, digits, `.`, `_` and `-` only. */
const toSlackBotName = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^\d._a-z-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80) || 'lobehub-assistant';

const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'files:read',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'pins:read',
  'pins:write',
  'reactions:read',
  'reactions:write',
  'users:read',
];

const SLACK_BOT_EVENTS = ['app_mention', 'message.channels', 'message.groups', 'message.im'];

/**
 * A Slack app manifest with the scopes, events and Socket Mode the bot
 * channel needs (same as the Slack setup guide), so nothing is set by hand.
 */
export const buildSlackManifest = ({
  description,
  name,
}: {
  description?: string;
  name: string;
}) => ({
  display_information: {
    name: name.slice(0, 35),
    ...(description ? { description: description.slice(0, 140) } : {}),
  },
  features: {
    app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    bot_user: { always_online: true, display_name: toSlackBotName(name) },
  },
  oauth_config: { scopes: { bot: SLACK_BOT_SCOPES } },
  settings: {
    event_subscriptions: { bot_events: SLACK_BOT_EVENTS },
    interactivity: { is_enabled: true },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
});

/** Opens Slack's "create app from manifest" flow pre-filled with the manifest above. */
export const buildSlackCreateAppUrl = (options: { description?: string; name: string }) => {
  const url = new URL(SLACK_APPS_URL);
  url.searchParams.set('new_app', '1');
  url.searchParams.set('manifest_json', JSON.stringify(buildSlackManifest(options)));
  return url.toString();
};

export const buildSlackAppPageUrl = (applicationId: string, page: 'general' | 'oauth') =>
  `${SLACK_APPS_URL}/${encodeURIComponent(applicationId)}/${page}`;
