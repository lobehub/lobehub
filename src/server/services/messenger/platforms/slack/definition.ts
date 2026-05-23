import type { MessengerPlatformDefinition } from '../types';
import { MessengerSlackBinder } from './binder';
import { slackOAuthAdapter } from './oauth';
import { slackWebhookGate } from './webhook';

export const slack: MessengerPlatformDefinition = {
  // SystemBot Slack is always Events API (webhook), even though a per-agent
  // bot-channel Slack provider can opt into Socket Mode/websocket.
  connectionMode: 'webhook',
  createBinder: (creds) => new MessengerSlackBinder(creds),
  id: 'slack',
  name: 'Slack',
  oauth: slackOAuthAdapter,
  webhookGate: slackWebhookGate,
};
