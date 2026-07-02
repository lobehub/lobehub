import { MessageApiName } from '@lobechat/builtin-tool-message';
import { channelDocUrl } from '@lobechat/const';

import type { PlatformDefinition } from '../types';
import { WechatClientFactory } from './client';
import { schema } from './schema';

// WeChat's iLink bot only supports outbound `sendMessage` — every other message
// operation throws `PlatformUnsupportedError` in `./service.ts`. Declaring them
// here lets the agent runtime trim them from the `lobe-message` tool so the model
// never calls (and then apologizes for) an operation that can only fail.
// Keep in sync with the throwing stubs in `./service.ts`.
const WECHAT_UNSUPPORTED_MESSAGE_APIS: string[] = [
  MessageApiName.readMessages,
  MessageApiName.editMessage,
  MessageApiName.deleteMessage,
  MessageApiName.searchMessages,
  MessageApiName.reactToMessage,
  MessageApiName.getReactions,
  MessageApiName.pinMessage,
  MessageApiName.unpinMessage,
  MessageApiName.listPins,
  MessageApiName.getChannelInfo,
  MessageApiName.listChannels,
  MessageApiName.getMemberInfo,
  MessageApiName.createThread,
  MessageApiName.listThreads,
  MessageApiName.replyToThread,
  MessageApiName.createPoll,
];

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
  unsupportedMessageApis: WECHAT_UNSUPPORTED_MESSAGE_APIS,
  clientFactory: new WechatClientFactory(),
};
