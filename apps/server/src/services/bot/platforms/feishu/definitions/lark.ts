import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../../messageCapabilities';
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
    setupGuideUrl: channelDocUrl('lark'),
  },
  schema: sharedSchema,
  supportsMarkdown: false,
  // See feishu definition — Lark shares the same event model.
  preInjectGroupHistory: true,
  // Outbound threads as replies to the triggering message (topic-group
  // replies land inside the topic instead of the group's main timeline).
  supportsReplyThreading: true,
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.lark,
  clientFactory: sharedClientFactory,
};
