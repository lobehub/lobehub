import * as Icons from '@lobehub/ui/icons';
import type { FC } from 'react';

export interface PlatformUI {
  /** 'auto' = webhook set via API (no URL to copy), 'manual' = user must copy endpoint URL */
  webhookMode?: 'auto' | 'manual';
}

/** Known icon names from @lobehub/ui/icons that correspond to chat platforms. */
const ICON_NAMES = [
  'Discord',
  'GoogleChat',
  'Lark',
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

export const PLATFORM_UI: Record<string, PlatformUI> = {
  discord: { webhookMode: 'auto' },
  feishu: { webhookMode: 'manual' },
  lark: { webhookMode: 'manual' },
  qq: { webhookMode: 'manual' },
  telegram: { webhookMode: 'auto' },
};
