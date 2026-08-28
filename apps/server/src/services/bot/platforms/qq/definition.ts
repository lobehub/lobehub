import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
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
    setupGuideUrl: channelDocUrl('qq'),
  },
  schema,
  supportsMarkdown: false,
  supportsMessageEdit: false,
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.qq,
  clientFactory: new QQClientFactory(),
};
