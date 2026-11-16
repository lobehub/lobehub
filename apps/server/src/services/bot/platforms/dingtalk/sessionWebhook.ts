import type { DingTalkAdapter, DingTalkRawMessage } from '@lobechat/chat-adapter-dingtalk';
import {
  DINGTALK_CONVERSATION_TYPE,
  verifyCallbackSignature,
} from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import { redisService } from '@/server/services/redis';

import { DINGTALK_SESSION_WEBHOOK_HOST_PATTERN } from './const';
import { formatDingTalkThreadId } from './threadId';

const log = debug('bot-platform:dingtalk:session-webhook');

/** A reply URL is only trusted when DingTalk issued it over HTTPS. */
export const isDingTalkSessionWebhookUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && DINGTALK_SESSION_WEBHOOK_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
};

/** Thread id for a callback payload — same derivation as the adapter's `threadIdFromRaw`. */
export const threadIdFromCallback = (raw: DingTalkRawMessage): string =>
  raw.conversationType === DINGTALK_CONVERSATION_TYPE.GROUP
    ? formatDingTalkThreadId({ id: raw.conversationId, type: 'group' })
    : formatDingTalkThreadId({ id: raw.senderStaffId || raw.senderId, type: 'single' });

/**
 * Remember the callback's `sessionWebhook` for the conversation it came from.
 *
 * Runs before the adapter sees the request, and only for a request whose
 * `timestamp` + `sign` check passes: the stored URL is later POSTed with the
 * agent's reply, so an unsigned request must never be able to plant one. The
 * host is pinned to `*.dingtalk.com` on top of that.
 */
export const captureSessionWebhook = async (
  request: Request,
  applicationId: string,
  clientSecret: string,
): Promise<void> => {
  if (
    !verifyCallbackSignature(
      request.headers.get('timestamp'),
      request.headers.get('sign'),
      clientSecret,
    )
  ) {
    return;
  }

  let raw: DingTalkRawMessage;
  try {
    raw = JSON.parse(await request.text()) as DingTalkRawMessage;
  } catch {
    return;
  }

  if (!raw?.conversationId || !raw.senderId) return;
  if (!raw.sessionWebhook || !raw.sessionWebhookExpiredTime) return;
  if (!isDingTalkSessionWebhookUrl(raw.sessionWebhook)) {
    log('ignoring sessionWebhook outside dingtalk.com for app %s', applicationId);
    return;
  }

  await redisService.botReply.rememberDingTalkSessionWebhook(
    applicationId,
    threadIdFromCallback(raw),
    { expiresAt: Number(raw.sessionWebhookExpiredTime), url: raw.sessionWebhook },
  );
};

/**
 * Make an adapter persist every inbound `sessionWebhook` before handling the
 * callback. The adapter keeps its own in-memory copy for replies it posts
 * itself; this copy is for the bot callback, which posts the agent's final
 * reply from whichever process the agent gateway calls back into.
 */
export const withSessionWebhookCapture = (
  adapter: DingTalkAdapter,
  applicationId: string,
  clientSecret: string,
): DingTalkAdapter => {
  const handleWebhook = adapter.handleWebhook.bind(adapter);
  adapter.handleWebhook = async (request, options) => {
    await captureSessionWebhook(request.clone(), applicationId, clientSecret).catch((error) => {
      log('failed to capture sessionWebhook for app %s: %O', applicationId, error);
    });
    return handleWebhook(request, options);
  };
  return adapter;
};
