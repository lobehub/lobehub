import type { PlatformDefinition } from '../../types';
import { sharedSchema } from './schema';
import { sharedClientFactory } from './shared';

export const feishu: PlatformDefinition = {
  id: 'feishu',
  name: 'Feishu',
  description: 'Connect a Feishu bot',
  documentation: {
    portalUrl: 'https://open.feishu.cn/app',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/feishu',
  },
  schema: sharedSchema,
  showWebhookUrl: true,
  supportsMarkdown: false,
  clientFactory: sharedClientFactory,
};
