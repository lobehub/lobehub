import { RequestTrigger, type TaskContext, type TaskTopicHandoff } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

import { AiAgentService } from '../aiAgent';

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

const isDuplicateKeyError = (error: unknown): boolean => {
  const err = error as { cause?: { code?: string }; code?: string; message?: string };
  const blob = `${err?.message ?? ''}${err?.cause?.code ?? ''}${err?.code ?? ''}`;
  return blob.includes('23505') || blob.includes('unique') || blob.includes('duplicate');
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
    const messageModel = new MessageModel(this.db, this.userId, this.workspaceId);

    // Anchor the callback on the creator topic's CURRENT leaf at delivery time —
    // NOT origin.messageId (the assistant turn that called createTask). A task
    // runs for minutes while the creator agent keeps talking, so origin.messageId
    // is a stale mid-conversation node; parenting there forks a hidden sibling
    // branch the linear UI never follows, so the user never sees the result
    //
    const parentId = await messageModel.getLastMainThreadSpineMessageId(origin.topicId);

    try {
      await messageModel.create(
        {
          agentId: origin.agentId,
          content,
          metadata: {
            taskCallback: { identifier: taskIdentifier, reason, taskId, topicId },
          },
          parentId,
          role: 'taskCallback',
          topicId: origin.topicId,
        },
        messageId,
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        log('task-callback %s already delivered, skipping', messageId);
        return;
      }
      throw error;
    }

    // Run the creator agent off history (no new user turn): the context engine
    // surfaces the task-callback card as a `<task_result>` user turn via
    // TaskCallbackMessageProcessor, so the agent reads it and continues.
    await new AiAgentService(this.db, this.userId, { workspaceId: this.workspaceId }).execAgent({
      agentId: origin.agentId,
      appContext: { topicId: origin.topicId },
      autoStart: true,
      parentMessageId: messageId,
      prompt: `Task ${taskIdentifier} ${reason}`,
      suppressUserMessage: true,
      trigger: RequestTrigger.AgentSignal,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    log('bridged task %s result into topic %s (%s)', taskIdentifier, origin.topicId, reason);
  }
}
