import type { PlatformDefinition } from '../types';
import { WeixinClientFactory } from './client';
import { schema } from './schema';

export const weixin: PlatformDefinition = {
  id: 'weixin',
  name: 'WeChat',
  connectionMode: 'websocket',
  description: 'Connect a WeChat bot via iLink API',
  documentation: {
    portalUrl: 'https://ilinkai.weixin.qq.com',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/weixin',
  },
  schema,
  supportsMessageEdit: false,
  clientFactory: new WeixinClientFactory(),
};
