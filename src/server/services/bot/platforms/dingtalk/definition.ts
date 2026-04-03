import type { PlatformDefinition } from '../types';
import { DingTalkClientFactory } from './client';
import { schema } from './schema';

export const dingtalk: PlatformDefinition = {
  id: 'dingtalk',
  name: 'DingTalk',
  description: 'channel.dingtalk.description',
  documentation: {
    portalUrl: 'https://open.dingtalk.com/',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/dingtalk',
  },
  schema,
  showWebhookUrl: true,
  supportsMessageEdit: false,
  clientFactory: new DingTalkClientFactory(),
};
