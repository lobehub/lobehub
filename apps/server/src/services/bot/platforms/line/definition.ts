import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
import type { PlatformDefinition } from '../types';
import { LineClientFactory } from './client';
import { schema } from './schema';

export const line: PlatformDefinition = {
  id: 'line',
  name: 'LINE',
  connectionMode: 'webhook',
  description: 'Connect a LINE Messaging API bot for direct and group chats.',
  documentation: {
    portalUrl: 'https://developers.line.biz/console/',
    setupGuideUrl: channelDocUrl('line'),
  },
  schema,
  showWebhookUrl: true,
  supportsMarkdown: false,
  supportsMessageEdit: false,
  clientFactory: new LineClientFactory(),
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.line,
};
