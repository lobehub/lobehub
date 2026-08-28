import type { ChatTopicBotContext, TaskContext, TaskTopicHandoff } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { sql } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import type { BotCallbackBody } from '@/server/services/bot/BotCallbackService';
import { BotCallbackService } from '@/server/services/bot/BotCallbackService';

import { AiAgentService } from '../aiAgent';
import { acquireTopicStartReservation } from '../aiAgent/topicStartReservation';
import { TaskResultCallbackRedisStore } from './redisStore';

const log = debug('lobe-server:taskResultBridge');

// Task statuses at which an automation task (heartbeat/schedule) is "done"
// enough to report back — so we don't ping the creator on every tick.
const TERMINAL_TASK_STATUS = new Set(['completed', 'failed', 'canceled']);

type CallbackReason = 'done' | 'error' | 'interrupted';

const FALLBACK_MAX_LENGTH = 2000;

const normalizeReason = (reason: string): CallbackReason => {
  if (reason === 'interrupted') return 'interrupted';
  if (reason === 'error') return 'error';
  // 'done' | 'max_steps' | 'cost_limit' | … → treat as a normal completion.
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

export interface CompleteCreatorWakeupParams {
  agentId: string;
  originTopicId: string;
  receiptIds: string[];
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

  /** Claim and start one aggregated creator wakeup for the topic. */
  async drain(agentId: string, originTopicId: string): Promise<void> {
    const callbackStore = new TaskResultCallbackRedisStore(
      this.userId,
      originTopicId,
      this.workspaceId,
    );
    const receipts = await callbackStore.claimPending();
    if (receipts.length === 0) return;

    const receiptIds = receipts.map((item) => item.id);
    const topicModel = new TopicModel(this.db, this.userId, this.workspaceId);
    const topic = await topicModel.findById(originTopicId);
    const botContext = topic?.metadata?.bot as ChatTopicBotContext | undefined;
    const hooks: AgentHook[] = [
      this.createCreatorCompletionHook(receiptIds, agentId, originTopicId, botContext),
    ];
    const reservationId = `task-result-wakeup-${receiptIds[0]}`;

    try {
      const reserved = await acquireTopicStartReservation({
        reservationId,
        topicId: originTopicId,
        topicModel,
      });
      if (!reserved) {
        await callbackStore.settle(receiptIds);
        return;
      }

      // Receipt ordering is a queue concern, not the conversation's source of
      // truth. Re-read the live spine only after owning the topic reservation
      // so the Creator sees every callback card that landed before this run.
      const parentMessageId = await new MessageModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).getLastMainThreadSpineMessageId(originTopicId);

      const result = await new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      }).execAgent({
        agentId,
        appContext: { topicId: originTopicId },
        autoStart: true,
        botContext,
        hooks,
        parentMessageId,
        prompt: `Process ${receipts.length} completed task result${receipts.length === 1 ? '' : 's'}`,
        suppressUserMessage: true,
        topicStartReservationId: reservationId,
        trigger: RequestTrigger.AgentSignal,
        userInterventionConfig: { approvalMode: 'headless' },
      });
      await callbackStore.attachCreatorOperation(receiptIds, result.operationId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start creator agent';
      await callbackStore.release(receiptIds, errorMessage);
      throw error;
    } finally {
      await topicModel.releaseTaskCallbackReservation(originTopicId, reservationId);
    }
  }

  async completeCreatorWakeup(params: CompleteCreatorWakeupParams): Promise<void> {
    const callbackStore = new TaskResultCallbackRedisStore(
      this.userId,
      params.originTopicId,
      this.workspaceId,
    );
    await callbackStore.settle(params.receiptIds);
    await this.drain(params.agentId, params.originTopicId);
  }

  private createCreatorCompletionHook(
    receiptIds: string[],
    agentId: string,
    originTopicId: string,
    botContext?: ChatTopicBotContext,
  ): AgentHook {
    return {
      handler: async (event) => {
        if (botContext?.platformThreadId) {
          const callbackStore = new TaskResultCallbackRedisStore(
            this.userId,
            originTopicId,
            this.workspaceId,
          );
          const deliveredChunkCount = await callbackStore.getDeliveredChunkCount(event.operationId);
          await new BotCallbackService(this.db).handleCallback(
            {
              ...event,
              applicationId: botContext.applicationId,
              messengerInstallationKey: botContext.messengerInstallationKey,
              platformThreadId: botContext.platformThreadId,
              type: 'completion',
              userId: this.userId,
              workspaceId: this.workspaceId,
            } as BotCallbackBody,
            {
              deliveredChunkCount,
              onChunkDelivered: (count) =>
                callbackStore.markDeliveryChunk(event.operationId, count),
              strictDelivery: true,
            },
          );
        }
        await this.completeCreatorWakeup({
          agentId,
          originTopicId,
          receiptIds,
        });
      },
      id: 'task-creator-completion',
      type: 'onComplete',
      webhook: {
        body: {
          agentId,
          applicationId: botContext?.applicationId,
          messengerInstallationKey: botContext?.messengerInstallationKey,
          platformThreadId: botContext?.platformThreadId,
          receiptIds,
          originTopicId,
          type: 'completion',
          userId: this.userId,
          workspaceId: this.workspaceId,
        },
        delivery: 'qstash',
        fallback: 'none',
        url: '/api/workflows/task/on-creator-complete',
      },
    };
  }
}
