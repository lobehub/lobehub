import { channelDocUrl } from '@lobechat/const';

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
  clientFactory: new ImessageClientFactory(),
};
