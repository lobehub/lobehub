import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
import type { PlatformDefinition } from '../types';
import { TelegramClientFactory } from './client';
import { schema } from './schema';

export const telegram: PlatformDefinition = {
  id: 'telegram',
  name: 'Telegram',
  connectionMode: 'webhook',
  description: 'Connect a Telegram bot',
  documentation: {
    portalUrl: 'https://t.me/BotFather',
    setupGuideUrl: channelDocUrl('telegram'),
  },
  schema,
  // Member chats only. Guest summons overlay TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS
  // via resolveUnsupportedMessageApis — a guest bot is not a chat member.
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.telegram,
  clientFactory: new TelegramClientFactory(),
};
