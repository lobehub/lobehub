import { Discord, Slack, Telegram } from '@lobehub/ui/icons';
import type { ReactNode } from 'react';

export type MessengerPlatform = 'telegram' | 'slack' | 'discord';

export const PLATFORM_LABELS: Record<MessengerPlatform, string> = {
  discord: 'Discord',
  slack: 'Slack',
  telegram: 'Telegram',
};

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
 * required for slash commands to appear in the guild even though the
 * messenger doesn't register any today (PR1 ships text-only commands in
 * DMs). `permissions=274877942784` is the bitfield for the minimum DM-set:
 * View Channels (1024) + Send Messages (2048) + Send Messages in Threads
 * (274877906944) — all needed for the @-mention/DM flows when we expand
 * past DM-only.
 */
export const buildDiscordInviteUrl = (applicationId: string): string => {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', applicationId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', '274877942784');
  return url.toString();
};

/**
 * Direct link to the bot's user profile in Discord. App IDs double as the
 * bot user id for bot accounts, so this URL opens the bot's profile page;
 * the user clicks "Send Message" to start a DM.
 */
export const buildDiscordOpenBotUrl = (applicationId: string): string =>
  `https://discord.com/users/${applicationId}`;
