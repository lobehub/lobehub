import type { MessengerPlatformDefinition } from '../types';
import { MessengerLinqBinder } from './binder';
import { linqWebhookGate } from './webhook';

/**
 * iMessage / SMS through LobeHub's shared Linq number pool. Global like
 * Telegram (one deployment-level credential bundle, empty tenant), but routed
 * per sender: the pool numbers are interchangeable and nobody owns one.
 */
export const linq: MessengerPlatformDefinition = {
  connectionMode: 'webhook',
  createBinder: () => new MessengerLinqBinder(),
  id: 'linq',
  name: 'iMessage',
  supportsMarkdown: false,
  supportsMessageEdit: false,
  webhookGate: linqWebhookGate,
};
