import { Discord, Slack, Telegram } from '@lobehub/ui/icons';
import type { ReactNode } from 'react';

export type MessengerPlatform = 'telegram' | 'slack' | 'discord';

export const PLATFORM_TAB_ICONS: Record<MessengerPlatform, ReactNode> = {
  discord: <Discord.Color size={16} />,
  slack: <Slack.Color size={16} />,
  telegram: <Telegram.Color size={16} />,
};

export const PlatformAvatar = ({
  platform,
  size,
}: {
  platform: MessengerPlatform;
  size: number;
}) => {
  if (platform === 'telegram') return <Telegram.Avatar size={size} />;
  if (platform === 'discord') return <Discord.Avatar size={size} />;
  return <Slack.Avatar size={size} />;
};

export const buildTelegramDeepLink = (botUsername: string): string =>
  `https://t.me/${botUsername.replace(/^@/, '')}?start=messenger`;

/**
 * Discord OAuth2 install URL — adds the bot to a guild the user picks.
 *
 * `bot` scope is what authorizes the install; `applications.commands` is
 * required for slash commands to appear in the guild even though v1 doesn't
 * register any (`MessengerRouter` skips Discord slash registration today).
 *
 * `permissions=309237763136` matches the per-agent Discord channel bot doc
 * (`docs/usage/channels/discord.zh-CN.mdx`) so the messenger and channel
 * products ask for the same surface — easier for users to grok, and lets
 * us add channel/@-mention features later without re-prompting consent.
 *
 *   Add Reactions             (64)             — inline 👀 / ✅ feedback
 * + View Channels             (1024)           — required for any guild surface
 * + Send Messages             (2048)           — DM + channel replies
 * + Embed Links               (16384)          — URL previews in replies
 * + Attach Files              (32768)          — agent file / image outputs
 * + Read Message History      (65536)          — context for replies in channels
 * + Create Public Threads     (34359738368)    — agent-spawned threads
 * + Send Messages in Threads  (274877906944)   — replies inside Discord threads
 * = 309237763136
 *
 * Keep this in sync with `docs/development/messenger/discord-app-setup.md`
 * when changing the requested permissions.
 */
export const buildDiscordInviteUrl = (applicationId: string): string => {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', applicationId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', '309237763136');
  return url.toString();
};

/**
 * Direct link to the bot's user profile in Discord. App IDs double as the
 * bot user id for bot accounts, so this URL opens the bot's profile page;
 * the user clicks "Send Message" to start a DM.
 */
export const buildDiscordOpenBotUrl = (applicationId: string): string =>
  `https://discord.com/users/${applicationId}`;
