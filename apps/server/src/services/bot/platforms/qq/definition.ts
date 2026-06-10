import type { PlatformDefinition } from '../types';
import { QQClientFactory } from './client';
import { DEFAULT_QQ_CONNECTION_MODE } from './const';
import { schema } from './schema';

export const qq: PlatformDefinition = {
  id: 'qq',
  name: 'QQ',
  connectionMode: DEFAULT_QQ_CONNECTION_MODE,
  description: 'Connect a QQ bot',
  documentation: {
    portalUrl: 'https://q.qq.com/',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/qq',
  },
  schema,
  supportsMarkdown: false,
  supportsMessageEdit: false,
  clientFactory: new QQClientFactory(),
};
