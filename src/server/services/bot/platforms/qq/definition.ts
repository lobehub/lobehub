import type { PlatformDefinition } from '../types';
import { QQClientFactory } from './client';
import { schema } from './schema';

export const qq: PlatformDefinition = {
  id: 'qq',
  name: 'QQ',
  description: 'Connect a QQ bot',
  documentation: {
    portalUrl: 'https://q.qq.com/',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/qq',
  },
  schema,
  showWebhookUrl: true,
  supportsMarkdown: false,
  supportsMessageEdit: false,
  clientFactory: new QQClientFactory(),
};
