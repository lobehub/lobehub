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
// Since 2024-09-04 a Messaging API channel starts from an Official Account.
export const LINE_ACCOUNT_ENTRY_URL = 'https://entry.line.biz/form/entry/unverified';
export const LINE_ACCOUNT_MANAGER_URL = 'https://manager.line.biz/';

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
  'commands',
  'files:read',
  'files:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'pins:read',
  'pins:write',
  'reactions:read',
  'reactions:write',
  'users:read',
];

const SLACK_BOT_EVENTS = [
  'app_mention',
  'message.channels',
  'message.groups',
  'message.im',
  'message.mpim',
];

/**
 * A Slack app manifest with the scopes, events and Socket Mode the bot needs
 * to chat (DMs, group DMs, channels and mentions), send files and answer the
 * `/new` and `/stop` commands, so nothing is set by hand.
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
    // The gateway handles these over Socket Mode, so no request URL is needed.
    slash_commands: [
      { command: '/new', description: 'Start a new conversation', should_escape: false },
      { command: '/stop', description: 'Stop the current execution', should_escape: false },
    ],
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

/** Longest app name Feishu / Lark registration accepts (`feishuRegisterBegin`). */
export const REGISTRATION_NAME_MAX_LENGTH = 64;

/**
 * The agent name as a registration preset: agent titles can be longer than the
 * registration API allows, so cut at the limit without splitting a character.
 */
export const toRegistrationName = (name: string): string => {
  let result = '';
  for (const char of name) {
    if (result.length + char.length > REGISTRATION_NAME_MAX_LENGTH) break;
    result += char;
  }
  return result;
};

/**
 * Milliseconds until the next registration poll. Every `slow_down` answer adds
 * five seconds for all later polls (RFC 8628 §3.5), not just the next one.
 */
export const registrationPollInterval = (intervalSeconds = 5, slowDowns = 0): number =>
  (intervalSeconds + slowDowns * 5) * 1000;

/** Failed polls in a row a registration tolerates before it gives up. */
export const MAX_TRANSIENT_POLL_FAILURES = 5;

/**
 * Runs one registration poll, answering `whilePending` for a failed request
 * (network, 5xx) until `MAX_TRANSIENT_POLL_FAILURES` fail in a row. The device
 * code stays valid meanwhile, so a scan completed around a hiccup is still
 * picked up instead of the flow failing and a second app being created.
 */
export const tolerateTransientPollFailure = async <T, P>(
  poll: () => Promise<T>,
  failures: { current: number },
  whilePending: P,
): Promise<T | P> => {
  try {
    const result = await poll();
    failures.current = 0;
    return result;
  } catch (error) {
    failures.current += 1;
    if (failures.current >= MAX_TRANSIENT_POLL_FAILURES) throw error;
    return whilePending;
  }
};

/**
 * Locale key for scan copy that names the app to open, so a Lark scan tells
 * the user to confirm in Lark rather than Feishu.
 */
export const scanCopyKey = (platform: 'feishu' | 'lark', key: 'denied' | 'title' | 'waiting') =>
  platform === 'lark'
    ? (`channel.quickSetup.feishu.scan.lark.${key}` as const)
    : (`channel.quickSetup.feishu.scan.${key}` as const);
