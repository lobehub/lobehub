import * as Icons from '@lobehub/ui/icons';
import type { FC } from 'react';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

/** Known icon names from @lobehub/ui/icons that correspond to chat platforms. */
const ICON_NAMES = [
  'Discord',
  'GoogleChat',
  'IMessage',
  'Lark',
  'Line',
  'MicrosoftTeams',
  'QQ',
  'Slack',
  'Telegram',
  'WeChat',
  'WhatsApp',
] as const;

/** Alias map for platforms whose display name differs from the icon name. */
const ICON_ALIASES: Record<string, string> = {
  feishu: 'Lark',
};

/**
 * Resolve icon component by matching against known icon names.
 * Accepts either a platform display name (e.g. "Feishu / Lark") or id (e.g. "discord").
 */
export function getPlatformIcon(nameOrId: string): FC<any> | undefined {
  const alias = ICON_ALIASES[nameOrId.toLowerCase()];
  if (alias) return (Icons as Record<string, any>)[alias];

  const name = ICON_NAMES.find(
    (n) => nameOrId.includes(n) || nameOrId.toLowerCase() === n.toLowerCase(),
  );
  return name ? (Icons as Record<string, any>)[name] : undefined;
}

/**
 * Channel platform definition extended with a frontend-only `comingSoon` flag.
 * Coming-soon platforms are virtual: they appear in the sidebar list and show
 * a placeholder detail view, but never participate in credentials/runtime flow.
 */
export interface ChannelPlatformDefinition extends SerializedPlatformDefinition {
  comingSoon?: boolean;
}

/**
 * Virtual platforms shown in the sidebar with a "Coming Soon" badge.
 * Not registered on the server — handled entirely on the client.
 */
export const COMING_SOON_PLATFORMS: ChannelPlatformDefinition[] = [
  {
    comingSoon: true,
    connectionMode: 'webhook',
    id: 'whatsapp',
    name: 'WhatsApp',
    schema: [],
  },
  {
    comingSoon: true,
    connectionMode: 'webhook',
    id: 'imessage',
    name: 'iMessage',
    schema: [],
  },
];
