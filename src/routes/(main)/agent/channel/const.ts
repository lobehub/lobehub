import { SiDiscord, SiTelegram } from '@icons-pack/react-simple-icons';
import type { LucideIcon } from 'lucide-react';
import type { FC } from 'react';

import { LarkIcon } from './icons';

export interface ChannelProvider {
  /** Lark-style auth: appId + appSecret instead of botToken */
  authMode?: 'app-secret' | 'bot-token';
  /** Whether applicationId can be auto-derived from the bot token */
  autoAppId?: boolean;
  color: string;
  description: string;
  docsLink: string;
  fieldTags: {
    appId: string;
    appSecret?: string;
    encryptKey?: string;
    publicKey?: string;
    secretToken?: string;
    token?: string;
    verificationToken?: string;
    webhook?: string;
  };
  icon: FC<any> | LucideIcon;
  id: string;
  name: string;
  /** 'manual' = user must copy endpoint URL to platform portal (Discord, Lark);
   *  'auto' = webhook is set automatically via API (Telegram) */
  webhookMode?: 'auto' | 'manual';
}

export const CHANNEL_PROVIDERS: ChannelProvider[] = [
  {
    color: '#5865F2',
    description: 'channel.discord.description',
    docsLink: 'https://discord.com/developers/docs/intro',
    fieldTags: {
      appId: 'Application ID',
      publicKey: 'Public Key',
      token: 'Bot Token',
    },
    icon: SiDiscord,
    id: 'discord',
    name: 'Discord',
    webhookMode: 'auto',
  },
  {
    autoAppId: true,
    color: '#26A5E4',
    description: 'channel.telegram.description',
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
  {
    authMode: 'app-secret',
    color: '#3370FF',
    description: 'channel.feishu.description',
    docsLink:
      'https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process',
    fieldTags: {
      appId: 'App ID',
      appSecret: 'App Secret',
      encryptKey: 'Encrypt Key',
      verificationToken: 'Verification Token',
      webhook: 'Event Subscription URL',
    },
    icon: LarkIcon,
    id: 'feishu',
    name: '飞书',
  },
  {
    authMode: 'app-secret',
    color: '#00D6B9',
    description: 'channel.lark.description',
    docsLink:
      'https://open.larksuite.com/document/home/introduction-to-custom-app-development/self-built-application-development-process',
    fieldTags: {
      appId: 'App ID',
      appSecret: 'App Secret',
      encryptKey: 'Encrypt Key',
      verificationToken: 'Verification Token',
      webhook: 'Event Subscription URL',
    },
    icon: LarkIcon,
    id: 'lark',
    name: 'Lark',
  },
];
