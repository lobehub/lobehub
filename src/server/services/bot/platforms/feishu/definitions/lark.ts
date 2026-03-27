import type { PlatformDefinition } from '../../types';
import { sharedSchema } from './schema';
import { sharedClientFactory } from './shared';

export const lark: PlatformDefinition = {
  id: 'lark',
  name: 'Lark',
  description: 'Connect a Lark bot',
  documentation: {
    portalUrl: 'https://open.larksuite.com/app',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/lark',
  },
  schema: sharedSchema,
  showWebhookUrl: true,
  supportsMarkdown: false,
  clientFactory: sharedClientFactory,
};
