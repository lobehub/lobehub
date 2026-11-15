import type { AgentAccountView } from '@/database/models/agentAccount';
import type { AgentInboxEntry } from '@/database/models/agentInbox';
import { normalizeMailAddress } from '@/database/models/agentMail';
import type {
  WakePolicy,
  WakePolicyMode,
  WakePolicyResult,
  WakeSignal,
} from '@/server/services/conversationWake/types';

import { isWakeSender } from './config';

export const MAIL_RULES_POLICY_ID = 'mail-wake:rules';

/** Revision of the mail-wake pipeline recorded on every decision. Bump when the judgement changes. */
export const MAIL_WAKE_PIPELINE_VERSION = 'mail-wake@1';

/**
 * Local parts that only machines send from: bounces, notification relays, no-reply senders. Mail
 * from them is never a reason to interrupt anyone at once; the digest still reads it.
 */
const AUTOMATED_LOCAL_PART =
  /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletters?|news|digest|updates?|marketing|info)(?:[-_.+].*)?$/;

/** Longest text the policies read: the subject and the start of the body are what they judge. */
const SIGNAL_TEXT_LENGTH = 2000;

/**
 * One inbox message as a wake policy reads it.
 *
 * The author's `id` is the sender's address and the channel is the account, keyed by thread, so
 * the shared wake types carry a mail without a mail-specific field.
 */
export const toMailWakeSignal = (account: AgentAccountView, entry: AgentInboxEntry): WakeSignal => {
  const from = normalizeMailAddress(entry.from);

  return {
    agentId: account.agentId,
    author: {
      id: from,
      isBot: AUTOMATED_LOCAL_PART.test(from.slice(0, from.lastIndexOf('@'))),
      isMe: from === normalizeMailAddress(account.identifier),
      isOwner: false,
      isSystem: false,
    },
    channelKeys: {
      channelKey: `agent-mail:${account.id}`,
      ids: [account.id],
      threadKey: entry.threadKey ?? undefined,
    },
    hasAttachments: entry.attachments.length > 0,
    message: [entry.subject, entry.text].filter(Boolean).join('\n\n').slice(0, SIGNAL_TEXT_LENGTH),
    platform: account.provider,
    platformThreadId: entry.threadKey ?? undefined,
    timestamp: entry.receivedAt.getTime(),
  };
};

const result = (
  verdict: WakePolicyResult['verdict'],
  reason: string,
  confidence: number,
): WakePolicyResult => ({ confidence, reason, tags: ['mail-rule', reason], verdict });

/**
 * The rules that decide whether a message is worth a run of its own right now.
 *
 * - The account's own address and machine senders (no-reply, bounces, notification relays) never
 *   are; they wait for the digest.
 * - A sender the owner listed always is.
 * - Anything else has no opinion here, and an abstaining message waits for the digest:
 *   being able to reach the address is not, by itself, a reason to start a run.
 *
 * A reply in a thread the agent itself wrote to does not reach this policy: the aggregator wakes
 * for it on its fast path (`replyToBot`).
 */
export const createMailRulesPolicy = (
  mode: WakePolicyMode,
  wakeSenders: readonly string[],
): WakePolicy => ({
  evaluate: ({ signal }) => {
    const { author } = signal;

    if (author?.isMe) return result('deny', 'self-message', 1);
    if (author?.isBot) return result('deny', 'automated-sender', 0.9);
    if (author?.id && isWakeSender(author.id, wakeSenders)) {
      return result('allow', 'wake-sender', 1);
    }

    return result('abstain', 'no-rule-hit', 0);
  },
  id: MAIL_RULES_POLICY_ID,
  mode,
  requires: [],
  version: 1,
});
