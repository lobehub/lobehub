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
  // Both of these are written and read by the user's own desktop bridge, which
  // holds `webhookSecret` as a shared secret with the cloud side and has no way
  // to ask for it back. Masking it would make the bridge persist the
  // placeholder and stop matching the server, so iMessage opts out and its
  // credentials stay visible to whoever can already read the channel.
  publicCredentialKeys: ['desktopDeviceId', 'webhookSecret'],
  schema,
  showWebhookUrl: false,
  supportsMarkdown: false,
  supportsMessageEdit: false,
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.imessage,
  clientFactory: new ImessageClientFactory(),
};
