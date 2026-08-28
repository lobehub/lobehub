import { MessageApiName } from '@lobechat/builtin-tool-message';

/**
 * `lobe-message` channel APIs each platform's runtime does NOT support — either
 * because its service throws `PlatformUnsupportedError`, or because the optional
 * method is absent and the execution runtime rejects it generically (e.g.
 * `sendDirectMessage` on every platform except Discord).
 *
 * This is the single source of truth consumed by `PlatformDefinition.unsupportedMessageApis`.
 * It drives two things in bot conversations:
 *   1. Manifest trimming — `resolveMessageManifest` removes these from the tool
 *      list so the model never calls an op that can only fail.
 *   2. History strategy — when `readMessages` is unsupported, the prompt stops
 *      telling the model to read history and we pre-inject recent channel history.
 *
 * Keep each entry in sync with the platform's `service.ts`. A missing entry means
 * "fully supported", so a platform that gains a limitation MUST be listed here —
 * do not rely on the default. Bot/messenger-management APIs (listBots, messenger
 * installs, …) are intentionally excluded: they're platform-independent and must
 * stay available inside any IM conversation.
 */
export const PLATFORM_UNSUPPORTED_MESSAGE_APIS: Record<string, string[]> = {
  // Discord implements the full surface — no entry needed, but keep it explicit.
  discord: [],
  feishu: [
    MessageApiName.createPoll,
    MessageApiName.createThread,
    MessageApiName.getReactions,
    MessageApiName.listChannels,
    MessageApiName.listPins,
    MessageApiName.listThreads,
    MessageApiName.pinMessage,
    MessageApiName.searchMessages,
    MessageApiName.sendDirectMessage,
    MessageApiName.unpinMessage,
  ],
  // iMessage supports readMessages/searchMessages, so history is read on demand.
  imessage: [
    MessageApiName.createPoll,
    MessageApiName.createThread,
    MessageApiName.deleteMessage,
    MessageApiName.editMessage,
    MessageApiName.getMemberInfo,
    MessageApiName.getReactions,
    MessageApiName.listPins,
    MessageApiName.listThreads,
    MessageApiName.pinMessage,
    MessageApiName.reactToMessage,
    MessageApiName.sendDirectMessage,
    MessageApiName.unpinMessage,
  ],
  // Lark shares Feishu's service, so it has the same limitations.
  lark: [
    MessageApiName.createPoll,
    MessageApiName.createThread,
    MessageApiName.getReactions,
    MessageApiName.listChannels,
    MessageApiName.listPins,
    MessageApiName.listThreads,
    MessageApiName.pinMessage,
    MessageApiName.searchMessages,
    MessageApiName.sendDirectMessage,
    MessageApiName.unpinMessage,
  ],
  // QQ has no history-read API → prompt uses pre-injected recent channel history.
  qq: [
    MessageApiName.createPoll,
    MessageApiName.createThread,
    MessageApiName.deleteMessage,
    MessageApiName.editMessage,
    MessageApiName.getChannelInfo,
    MessageApiName.getMemberInfo,
    MessageApiName.getReactions,
    MessageApiName.listChannels,
    MessageApiName.listPins,
    MessageApiName.listThreads,
    MessageApiName.pinMessage,
    MessageApiName.reactToMessage,
    MessageApiName.readMessages,
    MessageApiName.replyToThread,
    MessageApiName.searchMessages,
    MessageApiName.sendDirectMessage,
    MessageApiName.unpinMessage,
  ],
  slack: [MessageApiName.createPoll, MessageApiName.createThread, MessageApiName.sendDirectMessage],
  // Telegram has no history-read API → prompt uses pre-injected recent channel history.
  telegram: [
    MessageApiName.getReactions,
    MessageApiName.listChannels,
    MessageApiName.listPins,
    MessageApiName.listThreads,
    MessageApiName.readMessages,
    MessageApiName.searchMessages,
    MessageApiName.sendDirectMessage,
  ],
  // WeChat's iLink bot supports only outbound sendMessage → no history-read API.
  wechat: [
    MessageApiName.createPoll,
    MessageApiName.createThread,
    MessageApiName.deleteMessage,
    MessageApiName.editMessage,
    MessageApiName.getChannelInfo,
    MessageApiName.getMemberInfo,
    MessageApiName.getReactions,
    MessageApiName.listChannels,
    MessageApiName.listPins,
    MessageApiName.listThreads,
    MessageApiName.pinMessage,
    MessageApiName.reactToMessage,
    MessageApiName.readMessages,
    MessageApiName.replyToThread,
    MessageApiName.searchMessages,
    MessageApiName.sendDirectMessage,
    MessageApiName.unpinMessage,
  ],
};
