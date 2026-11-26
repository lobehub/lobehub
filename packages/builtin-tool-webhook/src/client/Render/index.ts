import type { BuiltinRender } from '@lobechat/types';

import { WebhookApiName } from '../../types';
import DeleteWebhookRender from './DeleteWebhook';
import ListWebhookCallsRender from './ListWebhookCalls';
import ListWebhooksRender from './ListWebhooks';
import SendTestWebhookRender from './SendTestWebhook';
import WebhookResultRender from './WebhookResult';

export const WebhookRenders: Record<string, BuiltinRender> = {
  [WebhookApiName.createWebhook]: WebhookResultRender as BuiltinRender,
  [WebhookApiName.deleteWebhook]: DeleteWebhookRender as BuiltinRender,
  [WebhookApiName.listWebhookCalls]: ListWebhookCallsRender as BuiltinRender,
  [WebhookApiName.listWebhooks]: ListWebhooksRender as BuiltinRender,
  [WebhookApiName.sendTestWebhook]: SendTestWebhookRender as BuiltinRender,
  [WebhookApiName.updateWebhook]: WebhookResultRender as BuiltinRender,
};
