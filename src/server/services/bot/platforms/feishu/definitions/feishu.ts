import type { PlatformDefinition } from '../../types';
import { DEFAULT_FEISHU_CONNECTION_MODE } from '../const';
import { sharedSchema } from './schema';
import { sharedClientFactory } from './shared';

export const feishu: PlatformDefinition = {
  id: 'feishu',
  name: 'Feishu',
  connectionMode: DEFAULT_FEISHU_CONNECTION_MODE,
  description: 'Connect a Feishu bot',
  documentation: {
    portalUrl: 'https://open.feishu.cn/app',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/feishu',
  },
  schema: sharedSchema,
  supportsMarkdown: false,
  clientFactory: sharedClientFactory,
};
