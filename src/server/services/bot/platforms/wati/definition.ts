import type { PlatformDefinition } from '../types';
import { WatiClientFactory } from './client';
import { schema } from './schema';

export const wati: PlatformDefinition = {
  id: 'wati',
  name: 'Wati (WhatsApp)',
  connectionMode: 'webhook',
  description: 'Connect WhatsApp via Wati — customers text your number and receive agent replies.',
  documentation: {
    portalUrl: 'https://app.wati.io',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/wati',
  },
  schema,
  showWebhookUrl: true,
  supportsMarkdown: false,
  supportsMessageEdit: false,
  clientFactory: new WatiClientFactory(),
};
