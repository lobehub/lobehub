import { Slack, Telegram } from '@lobehub/ui/icons';
import type { ReactNode } from 'react';

export type MessengerPlatform = 'telegram' | 'slack';

export const PLATFORM_LABELS: Record<MessengerPlatform, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
};

export const PLATFORM_TAB_ICONS: Record<MessengerPlatform, ReactNode> = {
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
  return <Slack.Avatar size={size} />;
};

export const buildTelegramDeepLink = (botUsername: string): string =>
  `https://t.me/${botUsername.replace(/^@/, '')}?start=messenger`;
