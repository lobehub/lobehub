import type { PlatformDefinition } from '../types';
import { WatiClientFactory } from './client';
import { schema } from './schema';

export const wati: PlatformDefinition = {
  id: 'wati',
  name: 'WhatsApp API (Wati)',
  connectionMode: 'webhook',
  description:
    'Connect WhatsApp Business via the Official API (Wati) — customers text your number and receive agent replies.',
  documentation: {
    portalUrl: 'https://app.wati.io',
    setupGuideUrl: 'https://docs.wati.io',
  },
  schema,
  showWebhookUrl: true,
  supportsMarkdown: false,
  supportsMessageEdit: false,
  /** WhatsApp has no edit — acks surface as extra messages and read like wrong answers. */
  skipStartupAck: true,
  clientFactory: new WatiClientFactory(),
};
