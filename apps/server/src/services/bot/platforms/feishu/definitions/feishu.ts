import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../../messageCapabilities';
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
    setupGuideUrl: channelDocUrl('feishu'),
  },
  schema: sharedSchema,
  supportsMarkdown: false,
  // Un-@-mentioned group chatter never reaches the bot's event stream —
  // pre-inject recent thread messages on every group wake-up (watermark-
  // incremental; group threads only).
  preInjectGroupHistory: true,
  // Outbound threads as replies to the triggering message (topic-group
  // replies land inside the topic instead of the group's main timeline).
  supportsReplyThreading: true,
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.feishu,
  clientFactory: sharedClientFactory,
};
