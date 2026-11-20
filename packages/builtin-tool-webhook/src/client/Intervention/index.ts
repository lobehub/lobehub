import type { BuiltinIntervention } from '@lobechat/types';

import { WebhookApiName } from '../../types';
import CreateWebhookIntervention from './CreateWebhook';
import DeleteWebhookIntervention from './DeleteWebhook';
import UpdateWebhookIntervention from './UpdateWebhook';

export const WebhookInterventions: Record<string, BuiltinIntervention> = {
  [WebhookApiName.createWebhook]: CreateWebhookIntervention as BuiltinIntervention,
  [WebhookApiName.deleteWebhook]: DeleteWebhookIntervention as BuiltinIntervention,
  [WebhookApiName.updateWebhook]: UpdateWebhookIntervention as BuiltinIntervention,
};
