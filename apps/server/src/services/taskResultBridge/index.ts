import type { TaskContext, TaskTopicHandoff } from '@lobechat/types';
import debug from 'debug';
import { sql } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

import { AiAgentService } from '../aiAgent';
import { TaskResultCallbackRedisStore } from './redisStore';
import { type CompleteCreatorWakeupParams, ResultWakeChannel } from './wakeChannel';

export type { CompleteCreatorWakeupParams } from './wakeChannel';
export { ResultWakeChannel } from './wakeChannel';

const log = debug('lobe-server:taskResultBridge');

// Task statuses at which an automation task (heartbeat/schedule) is "done"
// enough to report back — so we don't ping the creator on every tick.
const TERMINAL_TASK_STATUS = new Set(['completed', 'failed', 'canceled']);

type CallbackReason = 'done' | 'error' | 'interrupted';

const FALLBACK_MAX_LENGTH = 2000;

const normalizeReason = (reason: string): CallbackReason => {
  if (reason === 'interrupted') return 'interrupted';
  if (reason === 'error') return 'error';
  // 'done' | 'max_steps' | 'cost_limit' | 'tool_call_repeat_limit' | … →
  // treat as a normal completion.
  return 'done';
};

const truncate = (text: string): string =>
  text.length > FALLBACK_MAX_LENGTH ? `${text.slice(0, FALLBACK_MAX_LENGTH)}…` : text;

/**
 * Render the handoff (or a fallback) into the markdown body carried by the
 * task-callback message: it is both the card body AND — wrapped by
 * `TaskCallbackMessageProcessor` — what the creator agent reads to continue.
 */
const renderHandoff = (params: {
  errorMessage?: string;
  fallbackContent?: string;
  handoff?: TaskTopicHandoff;
  reason: CallbackReason;
}): string => {
  const { errorMessage, fallbackContent, handoff, reason } = params;

  if (reason !== 'done') {
    const lead = reason === 'error' ? 'The task failed.' : 'The task was interrupted.';
    const detail = errorMessage?.trim() || handoff?.summary?.trim() || fallbackContent?.trim();
    return detail ? `${lead}\n\n${truncate(detail)}` : lead;
  }

  const parts: string[] = [];
  if (handoff?.title) parts.push(`### ${handoff.title}`);
  const body = handoff?.summary?.trim() || fallbackContent?.trim();
  if (body) parts.push(truncate(body));
  if (handoff?.keyFindings?.length) {
    parts.push(['**Key findings**', ...handoff.keyFindings.map((f) => `- ${f}`)].join('\n'));
  }
  if (handoff?.nextAction) parts.push(`**Next action:** ${handoff.nextAction}`);
  return parts.join('\n\n') || 'Task completed.';
};

export interface DeliverTaskResultParams {
  /** Error text when the run failed. */
  errorMessage?: string;
  /** Raw final assistant text from the run — fallback when the handoff isn't ready. */
  lastAssistantContent?: string;
  operationId: string;
  /** Terminal reason from the lifecycle hook: 'done' | 'error' | 'interrupted' | … */
  reason: string;
  taskId: string;
  taskIdentifier: string;
  /** The task topic that just completed. */
  topicId?: string;
}

/**
 * Delivers a finished task's handoff back to the conversation that created it
 * Fire-and-forget: appends a `role='taskCallback'` card into the
 * creator topic and runs the creator agent off history so it reads the result
 * and continues — without impersonating a user turn.
 *
 * Invoked from `TaskLifecycleService.onTopicComplete` AFTER all status
 * transitions, so the automation gate below reads the settled task status
 * (never racing the post-tick terminal transition). The caller guards against
 * throws so a bridge failure never affects task status.
 */
export class TaskResultBridgeService {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  async deliver(params: DeliverTaskResultParams): Promise<void> {
    const { taskId, taskIdentifier, topicId } = params;

    const taskModel = new TaskModel(this.db, this.userId, this.workspaceId);
    const task = await taskModel.findById(taskId);
    const origin = (task?.context as TaskContext | undefined)?.origin;

    // No creator conversation to report back to (e.g. task created via API).
    if (!origin?.agentId || !origin?.topicId) {
      log('no origin for task %s, skipping bridge', taskIdentifier);
      return;
    }
    const originAgentId = origin.agentId;
    const originTopicId = origin.topicId;

    // Automation tasks (heartbeat/schedule) run many topics — only bridge once
    // the task itself reaches a terminal state, to avoid per-tick spam. One-shot
    // tasks have no automationMode and bridge on topic completion.
    if (task?.automationMode && !TERMINAL_TASK_STATUS.has(task.status)) {
      log('automation task %s not terminal (%s), deferring bridge', taskIdentifier, task.status);
      return;
    }

    const reason = normalizeReason(params.reason);

    const handoff = topicId
      ? (await new TaskTopicModel(this.db, this.userId, this.workspaceId).findByTopicId(topicId))
          ?.handoff
      : undefined;

    const content = renderHandoff({
      errorMessage: params.errorMessage,
      fallbackContent: params.lastAssistantContent,
      handoff: handoff ?? undefined,
      reason,
    });

    // Idempotency: a deterministic id keyed on (task, completed topic). QStash
    // can redeliver the `on-topic-complete` webhook (which drives this bridge) —
    // the second create loses the PK race and we skip.
    const messageId = `task-cb-${taskId}-${topicId ?? params.operationId}`;
    // Pass workspaceId: a workspace-scoped task's origin topic lives under the
    // team workspace, so the leaf lookup + create must use the matching
    // ownership predicate — a personal-mode model (workspace_id IS NULL) finds
    // no leaf and the callback would be created parentless.
    // Serialize callback-card insertion per creator topic. Two tasks can finish
    // at the same instant; without the advisory lock they can both anchor on
    // the same leaf and create sibling branches, hiding one result from the
    // creator's main spine.
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${originTopicId}))`);
      const messageModel = new MessageModel(tx, this.userId, this.workspaceId);
      const existing = await messageModel.findById(messageId);
      if (!existing) {
        const parentId = await messageModel.getLastMainThreadSpineMessageId(originTopicId);
        await messageModel.create(
          {
            agentId: originAgentId,
            content,
            metadata: {
              taskCallback: { identifier: taskIdentifier, reason, taskId, topicId },
            },
            parentId,
            role: 'taskCallback',
            topicId: originTopicId,
          },
          messageId,
        );
      }
    });

    await new TaskResultCallbackRedisStore(
      this.userId,
      originTopicId,
      this.workspaceId,
    ).createPending({
      agentId: originAgentId,
      callbackMessageId: messageId,
      operationId: params.operationId,
      taskId,
      taskTopicId: topicId,
    });

    await this.drain(originAgentId, originTopicId);
    log('queued task %s result for creator topic %s (%s)', taskIdentifier, originTopicId, reason);
  }

  private get channel() {
    return new ResultWakeChannel(this.db, this.userId, this.workspaceId, (params) =>
      new AiAgentService(this.db, this.userId, { workspaceId: this.workspaceId }).execAgent(params),
    );
  }

  /** See {@link ResultWakeChannel.queueWakeup}. */
  queueWakeup(params: Parameters<ResultWakeChannel['queueWakeup']>[0]): Promise<void> {
    return this.channel.queueWakeup(params);
  }

  /** Whether receipts are queued (and batched); see {@link ResultWakeChannel.queueWakeup}. */
  static canQueue(): boolean {
    return TaskResultCallbackRedisStore.isAvailable();
  }

  /** Claim and start one aggregated creator wakeup for the topic. */
  drain(agentId: string, originTopicId: string): Promise<void> {
    return this.channel.drain(agentId, originTopicId);
  }

  completeCreatorWakeup(params: CompleteCreatorWakeupParams): Promise<void> {
    return this.channel.completeCreatorWakeup(params);
  }
}
