import debug from 'debug';

import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import {
  ResultWakeChannel,
  type WakeChannelExecAgent,
} from '@/server/services/taskResultBridge/wakeChannel';

import { readSubTopicsEnabled } from './labGate';
import { deliverSubTopicReceipt } from './receipt';

const log = debug('lobe-server:sub-topic:settle');

export interface SubTopicTurnSettledParams {
  db: LobeChatDatabase;
  errorMessage?: string;
  lastAssistantContent?: string;
  operationId: string;
  reason: string;
  topicId: string;
  userId: string;
  workspaceId?: string;
}

/**
 * A top-level turn of `topicId` settled (done / error / a cap — never a stop).
 * Two things follow for sub-topics, both under Better Coding Experience:
 *
 * 1. If the topic is a sub-topic, its opener gets a receipt and is woken.
 * 2. Results that arrived while this topic was busy (its own sub-topics,
 *    tasks, background sub-agents) wake it now instead of waiting for the
 *    recovery sweep.
 *
 * Runs for native and heterogeneous turns alike (both settle through
 * `CompletionLifecycle.dispatchHooks`). Never throws.
 */
export const onSubTopicTurnSettled = async (
  params: SubTopicTurnSettledParams,
  deps: { execAgent: WakeChannelExecAgent },
) => {
  const { db, topicId, userId, workspaceId } = params;
  // Everything here is Better Coding Experience: with it off, a settle costs one preference read.
  if (!(await readSubTopicsEnabled(db, userId).catch(() => false))) return;
  const bridge = new ResultWakeChannel(db, userId, workspaceId, deps.execAgent);

  try {
    await deliverSubTopicReceipt(
      { queueWakeup: (wake) => bridge.queueWakeup(wake) },
      { ...params, labEnabled: true },
    );
  } catch (error) {
    log('reporting sub-topic %s failed: %O', topicId, error);
  }

  try {
    if (!ResultWakeChannel.canQueue()) return;
    const topic = await new TopicModel(db, userId, workspaceId).findById(topicId);
    if (topic?.agentId) await bridge.drain(topic.agentId, topicId);
  } catch (error) {
    log('waking %s for results that arrived while it ran failed: %O', topicId, error);
  }
};
