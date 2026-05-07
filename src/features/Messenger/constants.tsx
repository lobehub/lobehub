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
 * Direct link to the bot's user profile in Discord. App IDs double as the
 * bot user id for bot accounts, so this URL opens the bot's profile page;
 * the user clicks "Send Message" to start a DM.
 *
 * Note: the "Add to Discord server" install flow goes through
 * `/api/agent/messenger/discord/install` (OAuth code-grant) rather than a
 * hardcoded `discord.com/oauth2/authorize` URL, so the callback can persist
 * the guild as an audit row. Bot scopes / permissions live in
 * `src/server/services/messenger/platforms/discord/oauth.ts`.
 */
export const buildDiscordOpenBotUrl = (applicationId: string): string =>
  `https://discord.com/users/${applicationId}`;
