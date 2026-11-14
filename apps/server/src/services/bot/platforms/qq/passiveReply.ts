import type {
  QQApiClient,
  QQPassiveSlot,
  QQPassiveThreadType,
} from '@lobechat/chat-adapter-qq';
import { QQ_PASSIVE_LIMITS } from '@lobechat/chat-adapter-qq';
import debug from 'debug';

import { redisService } from '@/server/services/redis';

const log = debug('bot-platform:qq:passive');

/** Key shape shared with the adapter's own window bookkeeping: `{applicationId}:{threadId}`. */
export const passiveKeyOf = (applicationId: string, platformThreadId: string): string =>
  `${applicationId}:${platformThreadId}`;

const limitsFor = (threadType: string) =>
  QQ_PASSIVE_LIMITS[threadType as QQPassiveThreadType] ?? QQ_PASSIVE_LIMITS.group;

/**
 * Reserve one reply inside the conversation's passive window.
 *
 * A passive reply carries the `msg_id` of an inbound message and costs no quota. QQ also accepts
 * active messages, but those are rate limited (per bot and per group, and a group receives at most
 * 1000 messages a day), so the passive slot is tried first.
 */
export const reserveQQReply = async (
  applicationId: string,
  platformThreadId: string,
  threadType: string,
): Promise<QQPassiveSlot | null> => {
  const key = passiveKeyOf(applicationId, platformThreadId);

  return redisService.qqPassive.reserve(key, limitsFor(threadType));
};

/** Park a reply the current window could not carry, so the next inbound message delivers it. */
export const deferQQReply = async (
  applicationId: string,
  platformThreadId: string,
  content: string,
): Promise<void> => {
  if (!content.trim()) return;

  log('passive window closed for %s, deferring reply (%d chars)', platformThreadId, content.length);
  await redisService.qqPassive.savePending(
    passiveKeyOf(applicationId, platformThreadId),
    content,
  );
};

/** Text send that carries the reserved slot's `msg_id` / `msg_seq`. */
export const sendQQMessageInSlot = async (
  api: QQApiClient,
  threadType: string,
  targetId: string,
  content: string,
  slot: QQPassiveSlot,
): Promise<void> => {
  const options = { eventId: slot.eventId, msgId: slot.msgId, msgSeq: slot.seq };

  switch (threadType) {
    case 'group': {
      await api.sendGroupMessage(targetId, content, options);
      return;
    }
    case 'guild': {
      await api.sendGuildMessage(targetId, content, options);
      return;
    }
    case 'c2c': {
      await api.sendC2CMessage(targetId, content, options);
      return;
    }
    case 'dms': {
      await api.sendDmsMessage(targetId, content, options);
      return;
    }
    default: {
      await api.sendGroupMessage(targetId, content, options);
    }
  }
};

/** Uncoupled send — QQ's active-message path, subject to its frequency cap. */
export const sendQQMessageActive = async (
  api: QQApiClient,
  threadType: string,
  targetId: string,
  content: string,
): Promise<void> => {
  switch (threadType) {
    case 'group': {
      await api.sendGroupMessage(targetId, content);
      return;
    }
    case 'guild': {
      await api.sendGuildMessage(targetId, content);
      return;
    }
    case 'c2c': {
      await api.sendC2CMessage(targetId, content);
      return;
    }
    case 'dms': {
      await api.sendDmsMessage(targetId, content);
      return;
    }
    default: {
      await api.sendGroupMessage(targetId, content);
    }
  }
};
