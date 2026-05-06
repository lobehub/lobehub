import type { MessengerPlatformDefinition } from '../types';
import { MessengerSlackBinder } from './binder';
import { slackWebhookGate } from './webhook';

export const slack: MessengerPlatformDefinition = {
  createBinder: (creds) => new MessengerSlackBinder(creds),
  id: 'slack',
  name: 'Slack',
  webhookGate: slackWebhookGate,
};
