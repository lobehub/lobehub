import type { PlatformDefinition } from '../types';
import { WechatClientFactory } from './client';
import { schema } from './schema';

export const wechat: PlatformDefinition = {
  id: 'wechat',
  name: 'WeChat',
  connectionMode: 'websocket',
  description: 'Connect a WeChat bot via iLink API',
  documentation: {
    portalUrl: 'https://ilinkai.weixin.qq.com',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/wechat',
  },
  schema,
  supportsMessageEdit: false,
  clientFactory: new WechatClientFactory(),
};
