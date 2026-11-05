import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
import type { PlatformDefinition } from '../types';
import { WeComClientFactory } from './client';
import { schema } from './schema';

export const wecom: PlatformDefinition = {
  id: 'wecom',
  name: 'WeCom',
  connectionMode: 'websocket',
  description: 'Connect a WeCom (企业微信) AI bot over its long connection',
  documentation: {
    portalUrl: 'https://work.weixin.qq.com/wework_admin/frame',
    setupGuideUrl: channelDocUrl('wecom'),
  },
  // Replies ride the bot's own long connection (see protocol-spec.md), which the external
  // message gateway cannot relay yet.
  requiresInProcessConnection: true,
  schema,
  supportsMarkdown: true,
  // A sent message cannot be changed; the reply fills the stream bubble opened while the agent works.
  supportsMessageEdit: false,
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.wecom,
  clientFactory: new WeComClientFactory(),
};
