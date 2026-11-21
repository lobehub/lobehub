import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { TaskResultCallbackRedisStore } from '@/server/services/taskResultBridge/redisStore';
import {
  ResultWakeChannel,
  type WakeChannelExecAgent,
} from '@/server/services/taskResultBridge/wakeChannel';

import { deliverSubTopicReceipt, listReceiptsSince, SUB_TOPIC_RECEIPT_PREFIX } from './receipt';

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
 * A top-level turn of `topicId` settled (done / error / a cap — never a stop):
 *
 * 1. If the topic is a sub-topic (and was not detached), its parent gets a
 *    receipt and is woken.
 * 2. Sub-topic receipts that arrived while this topic was busy wake it now
 *    instead of waiting for the recovery sweep.
 *
 * Not gated on the Better Coding Experience lab — a sub-topic opened with
 * `lh topic send --new` reports back either way. Runs for native and
 * heterogeneous turns alike (both settle through
 * `CompletionLifecycle.dispatchHooks`). Never throws.
 */
export const onSubTopicTurnSettled = async (
  params: SubTopicTurnSettledParams,
  deps: { execAgent: WakeChannelExecAgent },
) => {
  const { db, topicId, userId, workspaceId } = params;
  const bridge = new ResultWakeChannel(db, userId, workspaceId, deps.execAgent);

  try {
    await deliverSubTopicReceipt(
      {
        canQueue: () => ResultWakeChannel.canQueue(),
        queueWakeup: (wake) => bridge.queueWakeup(wake),
      },
      params,
    );
  } catch (error) {
    log('reporting sub-topic %s failed: %O', topicId, error);
  }

  try {
    const topic = await new TopicModel(db, userId, workspaceId).findById(topicId);
    if (!topic?.agentId) return;
    if (ResultWakeChannel.canQueue()) {
      await bridge.drainIfPending(topic.agentId, topicId, SUB_TOPIC_RECEIPT_PREFIX);
      return;
    }
    // Without the queue, a receipt that arrived while this run held the topic
    // got no wake (the direct one could not reserve it). Catch up now, once,
    // for every receipt written since this run started.
    const run = await new AgentOperationModel(db, userId, workspaceId)
      .findById(params.operationId)
      .catch(() => undefined);
    if (!run?.createdAt) return;
    const receiptIds = await listReceiptsSince(db, topicId, run.createdAt);
    await bridge.wakeDirect({ agentId: topic.agentId, originTopicId: topicId, receiptIds });
  } catch (error) {
    log('waking %s for sub-topic receipts that arrived while it ran failed: %O', topicId, error);
  }
};

/**
 * A sub-topic run the watchdog finalized as abandoned (its device or process
 * went away): the parent still has to hear that it ended. The error receipt
 * is written here; its wake is queued for the task-result watchdog, which
 * drains every recoverable receipt scope with an agent runner of its own — so
 * this path needs none. Without Redis there is no queue, and the receipt waits
 * on the parent's main line for its next turn. Never throws.
 */
export const onAbandonedSubTopicRun = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  reason: string;
  topicId: string;
  userId: string;
  workspaceId?: string;
}) => {
  const { db, operationId, topicId, userId, workspaceId } = params;
  try {
    await deliverSubTopicReceipt(
      {
        canQueue: () => ResultWakeChannel.canQueue(),
        queueWakeup: async ({ agentId, callbackMessageId, originTopicId, receiptId }) => {
          if (!ResultWakeChannel.canQueue()) return;
          await new TaskResultCallbackRedisStore(userId, originTopicId, workspaceId).createPending({
            agentId,
            callbackMessageId,
            operationId: receiptId,
          });
        },
      },
      {
        db,
        errorMessage: `The run ended without finishing (${params.reason}).`,
        operationId,
        reason: 'error',
        topicId,
        userId,
        workspaceId,
      },
    );
  } catch (error) {
    log('reporting abandoned sub-topic run %s failed: %O', operationId, error);
  }
};
