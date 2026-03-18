import type { PlatformDefinition } from '../types';
import { TelegramClientFactory } from './client';
import { schema } from './schema';

export const telegram: PlatformDefinition = {
  id: 'telegram',
  name: 'Telegram',
  description: 'Connect a Telegram bot',
  documentation: {
    portalUrl: 'https://t.me/BotFather',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/telegram',
  },
  schema,
  clientFactory: new TelegramClientFactory(),
};
