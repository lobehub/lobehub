import type { PlatformDefinition } from '../types';
import { SlackClientFactory } from './client';
import { DEFAULT_SLACK_CONNECTION_MODE } from './const';
import { schema } from './schema';

export const slack: PlatformDefinition = {
  id: 'slack',
  name: 'Slack',
  connectionMode: DEFAULT_SLACK_CONNECTION_MODE,
  description: 'Connect a Slack bot',
  documentation: {
    portalUrl: 'https://api.slack.com/apps',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/slack',
  },
  schema,
  clientFactory: new SlackClientFactory(),
};
