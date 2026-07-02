import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
import type { PlatformDefinition } from '../types';
import { WechatClientFactory } from './client';
import { schema } from './schema';

export const wechat: PlatformDefinition = {
  id: 'wechat',
  name: 'WeChat',
  connectionMode: 'polling',
  description: 'Connect a WeChat bot via iLink API',
  documentation: {
    setupGuideUrl: channelDocUrl('wechat'),
  },
  schema,
  supportsMessageEdit: false,
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.wechat,
  clientFactory: new WechatClientFactory(),
};
