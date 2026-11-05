import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
import type { PlatformDefinition } from '../types';
import { DingTalkClientFactory } from './client';
import { DEFAULT_DINGTALK_CONNECTION_MODE } from './const';
import { schema } from './schema';

export const dingtalk: PlatformDefinition = {
  id: 'dingtalk',
  name: 'DingTalk',
  connectionMode: DEFAULT_DINGTALK_CONNECTION_MODE,
  description: 'Connect a DingTalk robot',
  documentation: {
    portalUrl: 'https://open-dev.dingtalk.com/',
    setupGuideUrl: channelDocUrl('dingtalk'),
  },
  schema,
  // Replies go out as `sampleMarkdown` whenever they contain markdown.
  supportsMarkdown: true,
  // Robot messages cannot be edited; step progress is skipped and only the
  // final reply is sent (streaming would need AI cards).
  supportsMessageEdit: false,
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.dingtalk,
  clientFactory: new DingTalkClientFactory(),
};
