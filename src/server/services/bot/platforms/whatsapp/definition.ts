import type { PlatformDefinition } from '../types';
import { WhatsAppClientFactory } from './client';
import { schema } from './schema';

export const whatsapp: PlatformDefinition = {
  id: 'whatsapp',
  name: 'WhatsApp',
  connectionMode: 'webhook',
  description: 'Connect a WhatsApp Business Cloud API phone number',
  documentation: {
    portalUrl: 'https://developers.facebook.com/apps/',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/whatsapp',
  },
  schema,
  showWebhookUrl: true,
  supportsMarkdown: false,
  supportsMessageEdit: false,
  clientFactory: new WhatsAppClientFactory(),
};
