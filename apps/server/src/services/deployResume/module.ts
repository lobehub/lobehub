import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { DeployResumeQueueItem } from '@/database/schemas/deployResumeQueue';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { startComposerRun } from '@/server/services/aiAgent/composerRun';
import { TaskRunnerService } from '@/server/services/taskRunner';

import { isDeployChatResumeEnabled } from './config';

const log = debug('deploy-resume');

/** What a resumed Task run is told before it picks the work back up. */
export const DEPLOY_RESUME_TASK_PROMPT =
  '上一轮因部署更新中断，请先检查已完成部分，再继续未完成的工作。';

/** The notice pinned into the conversation right before the resumed turn. */
export const DEPLOY_RESUME_NOTICE = '因部署更新中断，已自动继续。';

/**
 * How one row ended without throwing: `done` when a turn was restarted (or was
 * already running again), `skipped` when there was nothing left to restart.
 * Genuine failures throw instead, so the queue's retry loop sees them.
 */
export interface DeployResumeOutcome {
  reason?: string;
  status: 'done' | 'skipped';
}

/**
 * Insert the "resumed automatically" notice once per row.
 *
 * Only the first attempt writes it: a retry after a failed dispatch must not
 * stack a second notice into the same conversation. A notice that cannot be
 * written never blocks the run itself.
 */
const writeNotice = async (db: LobeChatDatabase, row: DeployResumeQueueItem, agentId?: string) => {
  if (row.attempts > 1) return;

  try {
    await new MessageModel(db, row.userId, row.workspaceId ?? undefined).create({
      agentId,
      content: DEPLOY_RESUME_NOTICE,
      role: 'assistant',
      topicId: row.topicId,
    });
  } catch (error) {
    log('failed to write the resume notice for %s: %O', row.topicId, error);
  }
};

/**
 * Restart an interrupted Task conversation.
 *
 * Dispatch goes through the Task runner, not `execAgent`, so the run gets the
 * Task's hooks, prompt and run-row hand-off exactly like any other Task run.
 * The topic is free by now — the deploy settled it as canceled, which is what
 * makes `continueTopicId` acceptable to the runner.
 */
const resumeTask = async (
  db: LobeChatDatabase,
  row: DeployResumeQueueItem,
  agentId: string | undefined,
  workspaceId: string | undefined,
): Promise<DeployResumeOutcome> => {
  if (!row.taskId) return { reason: 'queue row has no task id', status: 'skipped' };

  await writeNotice(db, row, agentId);

  const runner = new TaskRunnerService(db, row.userId, workspaceId);
  await runner.runTask({
    continueTopicId: row.topicId,
    extraPrompt: DEPLOY_RESUME_TASK_PROMPT,
    taskId: row.taskId,
    // A dedicated trigger so the run is attributable to the deploy in the task's
    // run list; lifecycle treats it like `manual` — it never spends the
    // automation quota and a failure does not pause a scheduled task.
    trigger: 'deploy-resume',
  });

  return { status: 'done' };
};

/**
 * Restart an interrupted plain conversation by resending its last user message.
 *
 * This is the same dispatch a composer send takes (`startComposerRun`), which
 * is what makes the resumed turn look like the user's own: it writes a new user
 * message anchored to the topic and starts a normal run. It deliberately does
 * not supersede a live run — a server-started turn waits instead of cutting
 * into whatever else is running.
 */
const resumeChat = async (
  db: LobeChatDatabase,
  row: DeployResumeQueueItem,
  agentId: string | undefined,
  workspaceId: string | undefined,
): Promise<DeployResumeOutcome> => {
  // A group conversation (or a topic that never bound an agent) has no single
  // agent to re-dispatch; the composer path only speaks to one agent.
  if (!agentId) {
    return { reason: 'topic has no single agent to resume', status: 'skipped' };
  }

  const messageModel = new MessageModel(db, row.userId, workspaceId);
  const prompt =
    row.payload?.lastUserMessage?.trim() ||
    (await messageModel.queryLastUserMessageByTopics([row.topicId])).get(row.topicId)?.trim();

  if (!prompt) return { reason: 'no user message to resend', status: 'skipped' };

  await writeNotice(db, row, agentId);

  const aiAgentService = new AiAgentService(db, row.userId, { workspaceId });
  await startComposerRun(
    { aiAgentService, db, supersedeLiveRun: false, userId: row.userId, workspaceId },
    {
      agentId,
      appContext: { topicId: row.topicId },
      // Nothing from the old turn is reused: the resume re-sends the prompt as a
      // fresh turn rather than continuing the interrupted run from its history.
      existingMessageIds: [],
      prompt,
      // A server-started turn, not a steer of the run it replaces.
      queuedSuccessor: true,
      trigger: RequestTrigger.Chat,
    },
  );

  return { status: 'done' };
};

/**
 * Resume one queued conversation.
 *
 * Resolves as `done`/`skipped` when there is nothing to retry, and throws when
 * the start failed in a way a later attempt might survive — the caller owns the
 * retry budget.
 */
export const resumeDeployRow = async (
  db: LobeChatDatabase,
  row: DeployResumeQueueItem,
): Promise<DeployResumeOutcome> => {
  // The deploy script does not even record chat rows unless asked, so this is
  // the safety net for a queue written while the switch was on (or by a deploy
  // whose environment differed from this container's).
  if (row.kind === 'chat' && !isDeployChatResumeEnabled()) {
    return { reason: 'chat replay is off (RESUME_CHAT_AFTER_DEPLOY)', status: 'skipped' };
  }

  const workspaceId = row.workspaceId ?? undefined;
  const topic = await new TopicModel(db, row.userId, workspaceId).findById(row.topicId);

  // Deleted, trashed or agent-share visitor topic: nothing here is the owner's
  // to restart.
  if (!topic) return { reason: 'topic no longer exists', status: 'skipped' };

  const operationModel = new AgentOperationModel(db, row.userId, workspaceId);

  // The run finished on its own in the window between the queue write and this
  // boot — the deploy settled an operation that had already answered.
  if (row.operationId) {
    const operation = await operationModel.findById(row.operationId);
    if (operation?.status === 'done') {
      return { reason: 'the interrupted run had already finished', status: 'skipped' };
    }
  }

  // Something is live on the topic again: another boot resumed this row first,
  // or the person wrote into the conversation while the container came up.
  // Either way restarting would double the turn.
  const live = await operationModel.findLiveByTopic(row.topicId);
  if (live.length > 0) {
    return { reason: `topic already has a live run (${live[0].id})`, status: 'done' };
  }

  return row.kind === 'task'
    ? resumeTask(db, row, topic.agentId ?? undefined, workspaceId)
    : resumeChat(db, row, topic.agentId ?? undefined, workspaceId);
};

/** Errors that will not change on a retry: the target is gone or forbidden. */
export const isPermanentResumeError = (error: unknown): boolean =>
  error instanceof TRPCError &&
  (error.code === 'FORBIDDEN' ||
    error.code === 'NOT_FOUND' ||
    error.code === 'PRECONDITION_FAILED');
