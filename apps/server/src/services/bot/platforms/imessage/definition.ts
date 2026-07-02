import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
import type { PlatformDefinition } from '../types';
import { ImessageClientFactory } from './client';
import { schema } from './schema';

export const imessage: PlatformDefinition = {
  id: 'imessage',
  name: 'iMessage',
  connectionMode: 'webhook',
  description: 'Connect iMessage through the local LobeHub Desktop BlueBubbles bridge.',
  documentation: {
    portalUrl: 'https://bluebubbles.app/',
    setupGuideUrl: channelDocUrl('imessage'),
  },
  schema,
  showWebhookUrl: false,
  supportsMarkdown: false,
  supportsMessageEdit: false,
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.imessage,
  clientFactory: new ImessageClientFactory(),
};
