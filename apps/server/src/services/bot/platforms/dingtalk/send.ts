import type { DingTalkApiClient, DingTalkOutboundMessage } from '@lobechat/chat-adapter-dingtalk';
import {
  DingTalkFormatConverter,
  MAX_MSG_PARAM_TEXT_BYTES,
  truncateUtf8,
} from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import { redisService } from '@/server/services/redis';

import { type DingTalkConversation, formatDingTalkThreadId } from './threadId';

const log = debug('bot-platform:dingtalk:send');

const formatConverter = new DingTalkFormatConverter();

/**
 * Pick the robot template for a reply. Markdown when the text uses markdown
 * syntax, plain text otherwise; the body is cut to the `msgParam` byte budget.
 */
export const toDingTalkOutbound = (text: string): DingTalkOutboundMessage => {
  const body = truncateUtf8(text.trim(), MAX_MSG_PARAM_TEXT_BYTES);
  return formatConverter.toOutboundMessage(body, body);
};

/**
 * Deliver one robot message to a DingTalk conversation.
 *
 * Order (protocol-spec §6.4): the conversation's latest `sessionWebhook`, when
 * one was captured from an inbound callback and is still valid — it needs no
 * access token or send permission and is the only route to external contacts.
 * When it is missing or DingTalk rejects it, the route is dropped and the
 * robot OpenAPI takes over: `groupMessages/send` for groups,
 * `oToMessages/batchSend` for single chats.
 *
 * Returns the `processQueryKey` of an OpenAPI send, or `undefined` for a
 * sessionWebhook send (DingTalk returns no id for those).
 */
export const sendDingTalkMessage = async (
  api: DingTalkApiClient,
  applicationId: string,
  conversation: DingTalkConversation,
  outbound: DingTalkOutboundMessage,
): Promise<string | undefined> => {
  const threadId = formatDingTalkThreadId(conversation);
  const session = await redisService.botReply.getDingTalkSessionWebhook(applicationId, threadId);

  if (session) {
    try {
      await api.replyViaSessionWebhook(session.url, outbound);
      return undefined;
    } catch (error) {
      // Never serialize the error: it may carry the credential-bearing webhook URL.
      log(
        'sessionWebhook rejected for %s, falling back to OpenAPI: %s',
        threadId,
        error instanceof Error ? error.name : 'unknown',
      );
      await redisService.botReply.forgetDingTalkSessionWebhook(applicationId, threadId);
    }
  }

  const result =
    conversation.type === 'group'
      ? await api.sendGroupMessage(conversation.id, outbound)
      : await api.sendSingleMessage([conversation.id], outbound);
  return result.processQueryKey;
};

/** Send a text/markdown reply; blank text is a no-op. */
export const sendDingTalkText = async (
  api: DingTalkApiClient,
  applicationId: string,
  conversation: DingTalkConversation,
  text: string,
): Promise<string | undefined> => {
  if (!text.trim()) return undefined;
  return sendDingTalkMessage(api, applicationId, conversation, toDingTalkOutbound(text));
};
