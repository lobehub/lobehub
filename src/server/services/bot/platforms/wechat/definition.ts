import type { PlatformDefinition } from '../types';
import { WechatClientFactory } from './client';
import { schema } from './schema';

export const wechat: PlatformDefinition = {
  authFlow: 'qrcode',
  id: 'wechat',
  name: 'WeChat',
  connectionMode: 'persistent',
  description: 'Connect a WeChat bot via iLink API',
  documentation: {
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/wechat',
  },
  schema,
  supportsMessageEdit: false,
  clientFactory: new WechatClientFactory(),
};
