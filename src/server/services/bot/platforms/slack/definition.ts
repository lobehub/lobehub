import type { PlatformDefinition } from '../types';
import { SlackClientFactory } from './client';
import { schema } from './schema';

export const slack: PlatformDefinition = {
  id: 'slack',
  name: 'Slack',
  description: 'Connect a Slack bot',
  documentation: {
    portalUrl: 'https://api.slack.com/apps',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/slack',
  },
  schema,
  showWebhookUrl: true,
  clientFactory: new SlackClientFactory(),
};
