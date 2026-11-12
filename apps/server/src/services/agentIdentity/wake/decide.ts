import type { SignalDecisionOutcome } from '@lobechat/types';
import debug from 'debug';

import type { AgentAccountView } from '@/database/models/agentAccount';
import type { AgentInboxEntry } from '@/database/models/agentInbox';
import { AgentMailModel } from '@/database/models/agentMail';
import { SignalDecisionModel } from '@/database/models/signalDecision';
import type { LobeChatDatabase } from '@/database/type';
import { aggregateWakeVerdicts } from '@/server/services/conversationWake/aggregator';
import { toWakeVerdicts } from '@/server/services/conversationWake/initiation';
import type { WakeDecision, WakeStateSnapshot } from '@/server/services/conversationWake/types';

import type { ResolvedWakeConfig } from './config';
import { resolveWakeConfig } from './config';
import { createMailRulesPolicy, MAIL_WAKE_PIPELINE_VERSION, toMailWakeSignal } from './policies';

const log = debug('lobe-server:agent-identity:mail-wake');

/**
 * What to do with one delivery.
 *
 * - `wake`: start a run for it now
 * - `defer`: leave it unread for the digest
 * - `skip`: leave it in the inbox; nothing will run for it
 */
export type MailWakeAction = 'defer' | 'skip' | 'wake';

export interface MailWakePlan {
  action: MailWakeAction;
  config: ResolvedWakeConfig;
  /** The rules' aggregate decision; absent when the account's wake is `off`. */
  decision?: WakeDecision;
  /** Why, as recorded on the decision row. */
  reason: string;
}

/**
 * Whether the sender is answering the agent: the thread holds mail the agent sent, and the sender
 * was among its recipients. Knowing a thread's key is not enough, so a stranger cannot borrow a
 * thread to jump the queue.
 */
const isReplyToAgent = (
  db: LobeChatDatabase,
  account: AgentAccountView,
  entry: AgentInboxEntry,
): Promise<boolean> =>
  entry.threadKey
    ? AgentMailModel.hasSentInThreadTo(db, {
        accountId: account.id,
        address: entry.from,
        threadKey: entry.threadKey,
      })
    : Promise.resolve(false);

/**
 * Decides whether a delivery wakes the agent now, waits for the digest, or neither.
 *
 * The rules are the shared wake policies run through the shared aggregator, so a mail decision
 * reads like a bot one in `signal_decisions`: an allow wakes the agent, anything else is deferred
 * to the digest.
 */
export const planMailWake = async (
  db: LobeChatDatabase,
  account: AgentAccountView,
  entry: AgentInboxEntry,
): Promise<MailWakePlan> => {
  const config = resolveWakeConfig(account.settings);
  if (config.mode === 'off') return { action: 'skip', config, reason: 'wake-off' };

  const snapshot: WakeStateSnapshot = {
    explicitMention: false,
    replyToBot: await isReplyToAgent(db, account, entry),
    threadSubscribed: false,
  };
  const decision = aggregateWakeVerdicts(
    [createMailRulesPolicy('enforce', config.wakeSenders)],
    toMailWakeSignal(account, entry),
    snapshot,
  );
  const action: MailWakeAction = decision.verdict === 'allow' ? 'wake' : 'defer';

  return { action, config, decision, reason: decision.reason };
};

const OUTCOME_BY_ACTION: Record<MailWakeAction, SignalDecisionOutcome> = {
  defer: 'defer',
  skip: 'skip',
  wake: 'wake',
};

export interface RecordMailWakeDecisionParams {
  account: AgentAccountView;
  /** What actually happened, which the wake budget may have changed from the plan. */
  action: MailWakeAction;
  plan: MailWakePlan;
  /** Why the action differs from the plan's, when it does (`rate-limited`). */
  reason?: string;
  signalId: string;
  topicId?: string;
}

/**
 * Keeps the decision for one delivery, so the rules can be judged against what happened. A `defer`
 * row is also what marks the message as waiting for the digest.
 *
 * Never throws: returns whether the row is on record, so a caller that depends on it (the defer
 * path) can fail the delivery, while the others carry on without the record.
 */
export const recordMailWakeDecision = async (
  db: LobeChatDatabase,
  { account, action, plan, reason, signalId, topicId }: RecordMailWakeDecisionParams,
): Promise<boolean> => {
  try {
    const recorded = await new SignalDecisionModel(
      db,
      account.userId,
      account.workspaceId ?? undefined,
    ).record({
      agentId: account.agentId,
      finalReason: reason ?? plan.reason,
      metadata: {
        extra: {
          mode: plan.config.mode,
          ...(plan.decision?.fastPath ? { fastPath: true } : {}),
        },
      },
      outcome: OUTCOME_BY_ACTION[action],
      pipelineVersion: MAIL_WAKE_PIPELINE_VERSION,
      scopeKey: `agent-mail:${account.id}`,
      signalId,
      toTag: plan.decision?.decidedBy,
      topicId,
      verdicts: plan.decision ? toWakeVerdicts(plan.decision) : [],
    });

    return !!recorded;
  } catch (error) {
    log('recording the decision for signal %s failed: %O', signalId, error);
    return false;
  }
};
