import { MessageApiName } from '@lobechat/builtin-tool-message';

import { isGuestTelegramThreadId } from './telegram/threadId';

/**
 * Channel-scoped `lobe-message` APIs (as opposed to bot/messenger management).
 * Telegram Guest Mode cannot perform any of these: the bot is not a chat
 * member and only has a single guest reply delivered by the outbound transport.
 */
export const CHANNEL_MESSAGE_APIS = [
  MessageApiName.sendMessage,
  MessageApiName.sendDirectMessage,
  MessageApiName.readMessages,
  MessageApiName.searchMessages,
  MessageApiName.editMessage,
  MessageApiName.deleteMessage,
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
] as const;

export const TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS: string[] = [...CHANNEL_MESSAGE_APIS];

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
 *
 * Telegram Guest Mode summons are NOT this map: they overlay
 * `TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS` via `resolveUnsupportedMessageApis`.
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

/**
 * Capability set for this invocation. Guest Telegram threads are not member
 * chats — regular channel tools would only fail at the Bot API — so they get
 * the guest overlay instead of `PLATFORM_UNSUPPORTED_MESSAGE_APIS.telegram`.
 */
export const resolveUnsupportedMessageApis = (
  platformId: string | undefined,
  platformThreadId?: string,
): string[] | undefined => {
  if (platformId === 'telegram' && platformThreadId && isGuestTelegramThreadId(platformThreadId)) {
    return TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS;
  }
  if (!platformId) return undefined;
  return PLATFORM_UNSUPPORTED_MESSAGE_APIS[platformId];
};
