import type { AgentSenderMetadata, ChatTopicMetadata, TopicOpenedBy } from '@lobechat/types';
import debug from 'debug';
import { and, eq, gte, like, sql } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { messages } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { assertCanUseTopicTargets } from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
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
  /**
   * Whether `queueWakeup` goes through the receipt queue, where a repeated
   * receipt id is a no-op (a delivered one stays recorded for hours). Only
   * then may a redelivered completion queue its wake again to repair a wake
   * that failed to enqueue; without the queue a second call would wake twice.
   */
  canQueue?: () => boolean;
  /**
   * Whether the member whose turn settled may run the opener: writing into it
   * and waking it starts the opener's agent under this member. Defaults to the
   * checks `aiAgent.execAgent` applies (`use` on its agent / group and topic).
   */
  canRunOpener?: (opener: {
    agentId: string;
    groupId?: null | string;
    id: string;
  }) => Promise<boolean>;
  /** Shared wake-up channel; see `ResultWakeChannel.queueWakeup`. */
  queueWakeup: (params: {
    agentId: string;
    callbackMessageId: string;
    originTopicId: string;
    receiptId: string;
  }) => Promise<void>;
}

export type SubTopicReceiptOutcome =
  'delivered' | 'duplicate' | 'hop_limit' | 'not_reportable' | 'opener_forbidden' | 'opener_gone';

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
/**
 * The sub-topic receipts written into `topicId` since `since` — results that
 * landed while one of its runs was going (see `onSubTopicTurnSettled`).
 * Receipts past the relay bound are left out: they were written so a person
 * sees them, and must not wake the opener later either.
 */
export const listReceiptsSince = async (
  db: LobeChatDatabase,
  topicId: string,
  since: Date,
): Promise<string[]> => {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.topicId, topicId),
        like(messages.id, `${SUB_TOPIC_RECEIPT_PREFIX}%`),
        gte(messages.createdAt, since),
        sql`COALESCE((${messages.metadata} -> 'agentSender' ->> 'hop')::int, 0) <= ${MAX_AGENT_RELAY_HOPS}`,
      ),
    );
  return rows.map((row) => row.id);
};

const defaultCanRunOpener =
  (scope: { db: LobeChatDatabase; userId: string; workspaceId?: string }) =>
  async (opener: { agentId: string; groupId?: null | string; id: string }) => {
    if (!scope.workspaceId) return true;
    await assertCanUseWorkspaceAgent({
      agentId: opener.agentId,
      db: scope.db,
      groupId: opener.groupId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    });
    await assertCanUseTopicTargets(
      { db: scope.db, userId: scope.userId, workspaceId: scope.workspaceId },
      [opener.id],
    );
    return true;
  };

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

  // Only a real top-level run of this sub-topic, started by this caller, may
  // report: a settle signal naming a made-up or foreign operation (a forged
  // `heteroFinish`) must not write into the parent or wake it.
  const operation = await new AgentOperationModel(db, userId, workspaceId)
    .findById(operationId)
    .catch(() => undefined);
  if (
    !operation ||
    operation.topicId !== topicId ||
    operation.parentOperationId ||
    operation.userId !== userId
  ) {
    log('no run %s of sub-topic %s by this caller; nothing reported', operationId, topicId);
    return 'not_reportable';
  }

  const opener = await topicModel.findById(openedBy.topicId);
  if (!opener?.agentId || (opener.status && RETIRED_STATUSES.has(opener.status))) {
    return 'opener_gone';
  }
  // Group conversations keep their own collaboration: a wake through the
  // shared channel would run without the group's context and supervisor role,
  // so a group parent is never reported to (and cannot open sub-topics).
  if (opener.groupId) {
    log('opener %s is a group conversation; nothing reported', opener.id);
    return 'not_reportable';
  }
  // A member may use a shared sub-topic yet only view its opener: their turn
  // must not write into the opener or wake it under their identity.
  const canRunOpener = deps.canRunOpener ?? defaultCanRunOpener({ db, userId, workspaceId });
  if (
    !(await canRunOpener({ agentId: opener.agentId, groupId: opener.groupId, id: opener.id }).catch(
      () => false,
    ))
  ) {
    log('%s may not run the opener %s; nothing reported', userId, opener.id);
    return 'opener_forbidden';
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
    const existing = await txMessages.findById(messageId);
    if (existing) {
      // The hop the receipt was written with, not the sub-topic's current one.
      const writtenHop = (existing.metadata as { agentSender?: AgentSenderMetadata } | null)
        ?.agentSender?.hop;
      return { hop: writtenHop ?? hop, written: false };
    }
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
    return { hop, written: true };
  });

  // A redelivered completion. The first delivery queued (or ran) the wake —
  // unless enqueueing failed after the message committed. With the queue a
  // repeated receipt id is a no-op, so queue it again: a missing wake is
  // repaired, a delivered or pending one is left as it is.
  const canRequeue = deps.canQueue?.() ?? false;
  if (!written.written && !canRequeue) return 'duplicate';

  if (written.hop > MAX_AGENT_RELAY_HOPS) {
    log(
      'sub-topic %s reached the relay bound (hop %d); %s is not woken',
      topicId,
      written.hop,
      opener.id,
    );
    return written.written ? 'hop_limit' : 'duplicate';
  }

  const wake = {
    agentId: opener.agentId,
    callbackMessageId: messageId,
    originTopicId: opener.id,
    receiptId: messageId,
  };
  try {
    await deps.queueWakeup(wake);
  } catch (error) {
    // The message is on the parent's main line; only its wake is missing.
    // Retry once when the queue makes a retry safe; otherwise the next
    // redelivery (or the parent's next turn, which reads the main line) picks it up.
    if (!canRequeue) throw error;
    log('queueing the wake for %s failed once, retrying: %O', messageId, error);
    await deps.queueWakeup(wake);
  }
  if (!written.written) return 'duplicate';
  log('reported sub-topic %s (%s) to %s', topicId, reason, opener.id);
  return 'delivered';
};
