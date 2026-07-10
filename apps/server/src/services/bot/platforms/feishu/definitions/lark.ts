import type { PlatformDefinition } from '../../types';
import { DEFAULT_FEISHU_CONNECTION_MODE } from '../const';
import { sharedSchema } from './schema';
import { sharedClientFactory } from './shared';

export const lark: PlatformDefinition = {
  id: 'lark',
  name: 'Lark',
  connectionMode: DEFAULT_FEISHU_CONNECTION_MODE,
  description: 'Connect a Lark bot',
  documentation: {
    portalUrl: 'https://open.larksuite.com/app',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/lark',
  },
  schema: sharedSchema,
  supportsMarkdown: false,
  clientFactory: sharedClientFactory,
};
