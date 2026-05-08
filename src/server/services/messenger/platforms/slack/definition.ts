import type { MessengerPlatformDefinition } from '../types';
import { MessengerSlackBinder } from './binder';
import { slackOAuthAdapter } from './oauth';
import { slackWebhookGate } from './webhook';

export const slack: MessengerPlatformDefinition = {
  createBinder: (creds) => new MessengerSlackBinder(creds),
  id: 'slack',
  name: 'Slack',
  oauth: slackOAuthAdapter,
  webhookGate: slackWebhookGate,
};
