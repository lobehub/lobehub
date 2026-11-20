import { ABANDONED_OPERATION_ERROR_PREFIX } from '@lobechat/const/goal';
import { classifyCliQuotaMessage } from '@lobechat/heterogeneous-agents/errors';
import type { ChannelReplyErrorAction, ChatMessageError } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';

import { sanitizeVisitorError } from '@/database/models/message/visitor';
import type {
  ChannelReplyErrorDraft,
  ChannelReplyErrorFacts,
} from '@/database/repositories/channel';

/**
 * The device-side watchdog's error type for a CLI Agent that stopped producing output. Spelled
 * out here so the card handles it before every runtime ships the type.
 */
export const HETERO_AGENT_SILENCE_TIMEOUT = 'HeteroAgentSilenceTimeout';

/** Why a reply failed, in the terms the card explains and acts on. */
export type ChannelReplyFailureKind =
  /** The run could not be submitted at all. */
  | 'dispatch'
  /** The device the Agent runs on was offline or could not be reached. */
  | 'device'
  /** The run ended normally but wrote no reply. */
  | 'no_reply'
  /** The CLI's subscription is out of credits: only a top-up (or another account) helps. */
  | 'quota_credit'
  /** The CLI's plan window is spent; it reopens by itself. */
  | 'quota_usage'
  /** The CLI on the device produced no output for too long and was stopped there. */
  | 'silence'
  /** The platform found the run without progress for too long and abandoned it. */
  | 'watchdog'
  | 'generic';

const DEVICE_ERROR_TYPES = new Set<string>([
  ChatErrorType.DeviceGatewayNotConfigured,
  ChatErrorType.ShareHeteroDeviceUnavailable,
]);

export const classifyReplyFailure = (facts: ChannelReplyErrorFacts): ChannelReplyFailureKind => {
  const type = facts.operation?.error?.type;
  const message = facts.operation?.error?.message;
  if (type && DEVICE_ERROR_TYPES.has(type)) return 'device';
  if (type === HETERO_AGENT_SILENCE_TIMEOUT) return 'silence';
  const quota = classifyCliQuotaMessage(message);
  if (quota) return quota.kind === 'credit_limit' ? 'quota_credit' : 'quota_usage';
  if (
    facts.operation?.status === 'abandoned' ||
    message?.trim().startsWith(ABANDONED_OPERATION_ERROR_PREFIX)
  )
    return 'watchdog';
  if (!facts.job.acceptedAt) return 'dispatch';
  if (facts.operation?.status === 'done') return 'no_reply';
  return 'generic';
};

/** A run that took its input left a conversation behind that `resume` can continue. */
export const canResumeReply = (facts: ChannelReplyErrorFacts) =>
  !!facts.job.topicId && !!facts.job.acceptedAt;

/** The next steps the server can carry out for this failure, best first. */
export const replyFailureActions = (
  kind: ChannelReplyFailureKind,
  facts: ChannelReplyErrorFacts,
): ChannelReplyErrorAction[] => {
  const resume = canResumeReply(facts);
  const actions: ChannelReplyErrorAction[] = (() => {
    switch (kind) {
      case 'device': {
        return ['retry', 'switch_device'];
      }
      case 'quota_credit': {
        return ['switch_device', 'retry'];
      }
      case 'quota_usage': {
        return resume ? ['resume', 'switch_device'] : ['retry', 'switch_device'];
      }
      case 'dispatch': {
        return ['retry'];
      }
      default: {
        return resume ? ['resume', 'retry'] : ['retry'];
      }
    }
  })();
  // A shared Agent's visitor cannot choose its owner's device.
  return facts.share ? actions.filter((action) => action !== 'switch_device') : actions;
};

type Copy = Record<ChannelReplyFailureKind, (name: string, started: boolean) => string>;

const ZH: Copy = {
  device: (name, started) =>
    started
      ? `${name} 所在的设备断开了，回复没能完成。`
      : `连不上 ${name} 所在的设备，回复没能开始。`,
  dispatch: (name) => `${name} 的回复没能启动。`,
  generic: (name) => `${name} 的回复中途出错，没能完成。`,
  no_reply: (name) => `${name} 运行结束了，但没有写出回复。`,
  quota_credit: (name) => `${name} 使用的账号额度已用完，需要充值或换一台设备。`,
  quota_usage: (name) => `${name} 使用的账号已达到用量上限，额度重置后可以继续。`,
  silence: (name) => `${name} 在设备上长时间没有任何输出，这次回复被中止了。`,
  watchdog: (name) => `${name} 长时间没有进展，这次回复被系统中止了。`,
};

const EN: Copy = {
  device: (name, started) =>
    started
      ? `${name}'s device disconnected, so the reply could not finish.`
      : `${name}'s device could not be reached, so the reply did not start.`,
  dispatch: (name) => `${name}'s reply could not start.`,
  generic: (name) => `${name} ran into an error and could not finish this reply.`,
  no_reply: (name) => `${name} finished running without writing a reply.`,
  quota_credit: (name) => `${name}'s account is out of credits; top it up or use another device.`,
  quota_usage: (name) => `${name}'s account hit its usage limit; you can continue once it resets.`,
  silence: (name) => `${name} went silent on its device for too long, so this reply was stopped.`,
  watchdog: (name) => `${name} stopped making progress, so the system ended this reply.`,
};

/** Chinese copy for a Chinese locale, English for everything else. */
export const isChineseLocale = (locale: string) => locale.toLowerCase().startsWith('zh');

/**
 * The raw failure as the card shows it under "details". A shared Agent runs under its owner's
 * credentials, so a shared card never persists that text: it takes the share page's projection
 * (`sanitizeVisitorError`), the same one `view.ts` reapplies when it hands the card to a reader —
 * the stored card is read by every member of the Channel, not only by the share's visitor.
 */
const visibleError = (facts: ChannelReplyErrorFacts) => {
  const raw = facts.operation?.error;
  if (!raw?.message && !raw?.type) return { errorMessage: null, errorType: null };
  const error = { message: raw.message ?? '', type: raw.type } as ChatMessageError;
  const shown = facts.share ? sanitizeVisitorError(error) : error;
  return {
    errorMessage: shown?.message ? shown.message.slice(0, 2000) : null,
    errorType: shown?.type?.toString() ?? null,
  };
};

/**
 * The card written as soon as a reply fails: a fixed sentence per failure kind in the requester's
 * language, and the actions the server allows. A model may refine the sentence later; this one
 * stands when it cannot.
 */
export const ruleBasedReplyError = (
  facts: ChannelReplyErrorFacts,
  locale: string,
  now = new Date(),
): ChannelReplyErrorDraft & { kind: ChannelReplyFailureKind } => {
  const kind = classifyReplyFailure(facts);
  const name = facts.agent.name || 'Agent';
  const copy = isChineseLocale(locale) ? ZH : EN;
  return {
    actions: replyFailureActions(kind, facts),
    deviceId: kind === 'device' || kind === 'silence' ? facts.deviceId : null,
    ...visibleError(facts),
    kind,
    occurredAt: now.toISOString(),
    summary: copy[kind](name, !!facts.job.acceptedAt),
  };
};
