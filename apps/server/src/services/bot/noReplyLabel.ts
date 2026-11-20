import { botWakeNoReplyCounter } from '@lobechat/observability-otel/modules/bot-wake';
import type { BotNoReplyResult } from '@lobechat/types';
import { BOT_NO_REPLY_LABELS } from '@lobechat/types';
import debug from 'debug';

import { SignalModel } from '@/database/models/signal';
import { SignalDecisionModel } from '@/database/models/signalDecision';
import type { LobeChatDatabase } from '@/database/type';

import { BOT_WAKE_PIPELINE_VERSION } from './BotMessageRouter/wakeDecision';

const log = debug('lobe-server:bot:no-reply-label');

/** `signal_decision_labels.source` for a label the agent itself produced by staying silent. */
export const NO_REPLY_LABEL_SOURCE = 'agent:no_reply';

export interface RecordNoReplyLabelParams {
  applicationId: string;
  noReply: BotNoReplyResult;
  operationId?: string;
  /** Lowercase platform id, e.g. `discord`. */
  platform: string;
  platformThreadId: string;
  userId: string;
  /** The inbound message the wake was recorded against. */
  userMessageId: string;
  workspaceId?: string;
}

/**
 * Writes a silence onto the wake decision that started the run: `false_wake` / `dup_wake` by
 * reason, with the reason itself in `metadata.reason` so `source` stays a plain origin. The decision is found through the signal key the router recorded it
 * under, so no id has to travel with the run.
 *
 * Never throws: labelling is bookkeeping and must not turn a clean silence into a failed run.
 * Returns the label written, or `undefined` when there was no decision to attach it to.
 */
export const recordNoReplyLabel = async (
  db: LobeChatDatabase,
  params: RecordNoReplyLabelParams,
): Promise<string | undefined> => {
  const { applicationId, noReply, operationId, platform, platformThreadId, userMessageId } = params;

  try {
    const signal = await new SignalModel(db, params.userId, params.workspaceId).findByExternalId(
      `bot:${platform}`,
      `${applicationId}:${platformThreadId}:${userMessageId}`,
    );
    if (!signal) {
      botWakeNoReplyCounter.add(1, { reason: noReply.reason, result: 'no_decision' });
      log('no signal for thread=%s message=%s, label skipped', platformThreadId, userMessageId);
      return undefined;
    }

    const decisions = new SignalDecisionModel(db, params.userId, params.workspaceId);
    const decision = (await decisions.listBySignal(signal.id)).find(
      (d) => d.pipelineVersion === BOT_WAKE_PIPELINE_VERSION,
    );
    if (!decision) {
      botWakeNoReplyCounter.add(1, { reason: noReply.reason, result: 'no_decision' });
      log('no decision for signal=%s, label skipped', signal.id);
      return undefined;
    }

    const label = BOT_NO_REPLY_LABELS[noReply.reason];
    await decisions.addLabel(decision.id, {
      actor: operationId,
      label,
      metadata: { reason: noReply.reason, surface: 'agent' },
      source: NO_REPLY_LABEL_SOURCE,
    });
    botWakeNoReplyCounter.add(1, { reason: noReply.reason, result: 'labelled' });
    return label;
  } catch (error) {
    botWakeNoReplyCounter.add(1, { reason: noReply.reason, result: 'error' });
    log('recordNoReplyLabel failed: %O', error);
    return undefined;
  }
};
