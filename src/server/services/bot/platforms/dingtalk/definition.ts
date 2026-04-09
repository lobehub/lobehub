import type { PlatformDefinition } from '../types';
import { DingTalkClientFactory } from './client';
import { schema } from './schema';

export const dingtalk: PlatformDefinition = {
  clientFactory: new DingTalkClientFactory(),
  connectionMode: 'webhook',
  description: 'channel.dingtalk.description',
  documentation: {
    portalUrl: 'https://open.dingtalk.com/',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/dingtalk',
  },
  id: 'dingtalk',
  name: 'DingTalk',
  schema,
  showWebhookUrl: true,
  supportsMessageEdit: false,
};
