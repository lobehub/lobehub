import { WEBHOOK_EVENT_TAG } from '@/const/plugin';

import { type MarkdownElement } from '../type';
import { remarkWebhookEventBlock } from './remarkWebhookEventBlock';
import Component from './Render';

const WebhookEventElement: MarkdownElement = {
  Component,
  remarkPlugin: remarkWebhookEventBlock,
  scope: 'user',
  tag: WEBHOOK_EVENT_TAG,
};

export default WebhookEventElement;
