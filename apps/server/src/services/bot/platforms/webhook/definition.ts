import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
import type { PlatformDefinition } from '../types';
import { BotWebhookClientFactory } from './client';
import { WEBHOOK_PLATFORM_ID } from './protocol';
import { schema } from './schema';

export const webhook: PlatformDefinition = {
  id: WEBHOOK_PLATFORM_ID,
  name: 'Custom Webhook',
  connectionMode: 'webhook',
  description:
    'Connect any chat platform: signed HTTP POSTs in, agent replies POSTed to your callback URL.',
  documentation: {
    setupGuideUrl: channelDocUrl('webhook'),
  },
  schema,
  showWebhookUrl: true,
  supportsMarkdown: true,
  // An edit is a `bot.message.updated` event; skipping per-step progress keeps the
  // receiver from having to coalesce a stream of updates into one message.
  supportsMessageEdit: false,
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.webhook,
  clientFactory: new BotWebhookClientFactory(),
};
