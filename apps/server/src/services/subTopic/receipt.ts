import type { AgentSenderMetadata, ChatTopicMetadata, TopicOpenedBy } from '@lobechat/types';
import debug from 'debug';
import { sql } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { MAX_AGENT_RELAY_HOPS } from '@/server/services/aiAgent/sourceAttribution';

const log = debug('lobe-server:sub-topic:receipt');

const SUMMARY_MAX_LENGTH = 2000;

/** Prefix of a sub-topic receipt's id (its message id and its wake-up receipt). */
export const SUB_TOPIC_RECEIPT_PREFIX = 'subtopic-cb-';
const RETIRED_STATUSES = new Set(['archived', 'completed']);

/** A sub-topic's link to its opener, while it still reports to it. */
export const liveOpenedBy = (
  metadata: ChatTopicMetadata | null | undefined,
): TopicOpenedBy | undefined => {
  const openedBy = metadata?.openedBy;
  if (!openedBy?.topicId || openedBy.detachedAt) return;
  return openedBy;
};

const truncate = (text: string) =>
  text.length > SUMMARY_MAX_LENGTH ? `${text.slice(0, SUMMARY_MAX_LENGTH)}…` : text;

/**
 * The body the opener reads: the sub-topic's last reply, or why it stopped.
 * The sender block names the sub-topic, so the body stays the reply itself.
 */
export const renderSubTopicReceipt = (params: {
  errorMessage?: string;
  lastAssistantContent?: string;
  reason: 'done' | 'error';
  title?: string | null;
}): string => {
  const reply = params.lastAssistantContent?.trim();
  if (params.reason === 'error') {
    const detail = params.errorMessage?.trim() || reply;
    return detail
      ? `The sub-topic's turn failed.\n\n${truncate(detail)}`
      : "The sub-topic's turn failed.";
  }
  return reply ? truncate(reply) : 'The sub-topic finished its turn without a reply.';
};

export interface SubTopicReceiptParams {
  db: LobeChatDatabase;
  errorMessage?: string;
  lastAssistantContent?: string;
  /** The sub-topic turn that just settled. */
  operationId: string;
  reason: string;
  /** The topic whose turn settled. */
  topicId: string;
  userId: string;
  workspaceId?: string;
}

export interface SubTopicReceiptDeps {
  /** Shared wake-up channel; see `TaskResultBridgeService.queueWakeup`. */
  queueWakeup: (params: {
    agentId: string;
    callbackMessageId: string;
    originTopicId: string;
    receiptId: string;
  }) => Promise<void>;
}

export type SubTopicReceiptOutcome =
  'delivered' | 'duplicate' | 'hop_limit' | 'not_reportable' | 'opener_gone';

/**
 * Report a finished sub-topic turn to the conversation that opened it: a
 * message from the sub-topic's agent lands on the opener's main line, and
 * the opener is woken through the shared channel (batched with whatever else
 * arrived). Nothing is sent for a stopped turn (the caller only reports
 * settled ones), a detached sub-topic, a task run (its task reports for it)
 * It does not depend on the Better Coding Experience lab: a
 * sub-topic opened by `lh topic send --new` reports back either way.
 *
 * The receipt carries the relay hop — one more than the hop that started the
 * sub-topic's turn — so "opener sends → sub-topic reports → opener sends
 * again" counts toward {@link MAX_AGENT_RELAY_HOPS} like any agent → agent
 * send. Past the bound the receipt is still written but the opener is not
 * woken: a person has to step in.
 */
export const deliverSubTopicReceipt = async (
  deps: SubTopicReceiptDeps,
  params: SubTopicReceiptParams,
): Promise<SubTopicReceiptOutcome> => {
  const { db, operationId, topicId, userId, workspaceId } = params;
  if (params.reason === 'interrupted') return 'not_reportable';
  const reason: 'done' | 'error' = params.reason === 'error' ? 'error' : 'done';

  const topicModel = new TopicModel(db, userId, workspaceId);
  const topic = await topicModel.findById(topicId);
  const openedBy = liveOpenedBy(topic?.metadata);
  // A task run reports through its task (`TaskResultBridgeService.deliver`).
  if (!topic?.agentId || !openedBy || topic.trigger === 'task') return 'not_reportable';

  const opener = await topicModel.findById(openedBy.topicId);
  if (!opener?.agentId || (opener.status && RETIRED_STATUSES.has(opener.status))) {
    return 'opener_gone';
  }

  const messageModel = new MessageModel(db, userId, workspaceId);
  const triggerHop = await messageModel.findLatestUserTurnHop({ topicId }).catch(() => undefined);
  const hop = (triggerHop ?? 0) + 1;

  const agentModel = new AgentModel(db, userId, workspaceId);
  const display = await agentModel.getAgentDisplayFields(topic.agentId).catch(() => undefined);
  const agentSender: AgentSenderMetadata = {
    agentId: topic.agentId,
    avatar: display?.avatar ?? undefined,
    hop,
    name: display?.name ?? undefined,
    title: display?.title ?? undefined,
    topicAgentId: topic.agentId,
    topicId,
    topicTitle: topic.title ?? undefined,
  };

  const content = renderSubTopicReceipt({
    errorMessage: params.errorMessage,
    lastAssistantContent: params.lastAssistantContent,
    reason,
    title: topic.title,
  });

  // Deterministic id: a redelivered completion finds the row and skips it.
  // Serialized per opener topic with every other result delivery, so two
  // receipts cannot anchor on the same leaf and fork its main line.
  const messageId = `${SUB_TOPIC_RECEIPT_PREFIX}${operationId}`;
  const written = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${opener.id}))`);
    const txMessages = new MessageModel(tx, userId, workspaceId);
    if (await txMessages.findById(messageId)) return false;
    const parentId = await txMessages.getLastMainThreadSpineMessageId(opener.id);
    await txMessages.create(
      {
        agentId: opener.agentId!,
        content,
        metadata: {
          agentSender,
          subTopicCallback: {
            agentId: topic.agentId!,
            operationId,
            reason,
            title: topic.title ?? undefined,
            topicId,
          },
        },
        parentId,
        role: 'user',
        topicId: opener.id,
      },
      messageId,
    );
    return true;
  });
  // A redelivered completion: the first delivery already queued (or ran) the wake.
  if (!written) return 'duplicate';

  if (hop > MAX_AGENT_RELAY_HOPS) {
    log('sub-topic %s reached the relay bound (hop %d); %s is not woken', topicId, hop, opener.id);
    return 'hop_limit';
  }

  await deps.queueWakeup({
    agentId: opener.agentId,
    callbackMessageId: messageId,
    originTopicId: opener.id,
    receiptId: messageId,
  });
  log('reported sub-topic %s (%s) to %s', topicId, reason, opener.id);
  return 'delivered';
};
