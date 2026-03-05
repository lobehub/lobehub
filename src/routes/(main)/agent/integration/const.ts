import { SiDiscord, SiTelegram } from '@icons-pack/react-simple-icons';
import type { LucideIcon } from 'lucide-react';
import type { FC } from 'react';

export interface IntegrationProvider {
  /** Whether applicationId can be auto-derived from the bot token */
  autoAppId?: boolean;
  color: string;
  description: string;
  docsLink: string;
  fieldTags: {
    appId: string;
    publicKey?: string;
    secretToken?: string;
    token: string;
    webhook?: string;
  };
  icon: FC<any> | LucideIcon;
  id: string;
  name: string;
  /** 'manual' = user must copy endpoint URL to platform portal (Discord);
   *  'auto' = webhook is set automatically via API (Telegram) */
  webhookMode?: 'auto' | 'manual';
}

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    color: '#5865F2',
    description: 'Connect this assistant to Discord server for channel chat and direct messages.',
    docsLink: 'https://discord.com/developers/docs/intro',
    fieldTags: {
      appId: 'Application ID',
      publicKey: 'Public Key',
      token: 'Bot Token',
      webhook: 'Interactions Endpoint URL',
    },
    icon: SiDiscord,
    id: 'discord',
    name: 'Discord',
  },
  {
    autoAppId: true,
    color: '#26A5E4',
    description: 'Connect this assistant to Telegram for private and group chats.',
    docsLink: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
    fieldTags: {
      appId: 'Bot User ID',
      secretToken: 'Webhook Secret',
      token: 'Bot Token',
    },
    icon: SiTelegram,
    id: 'telegram',
    name: 'Telegram',
    webhookMode: 'auto',
  },
];
