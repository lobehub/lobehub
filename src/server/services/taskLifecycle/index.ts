import { chainTaskTopicHandoff, TASK_TOPIC_HANDOFF_SCHEMA } from '@lobechat/prompts';
import type { TaskItem, TaskSchedulerContext } from '@lobechat/types';
import { DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';
import debug from 'debug';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { SystemAgentService } from '@/server/services/systemAgent';
import { TaskReviewService } from '@/server/services/taskReview';
import { createTaskSchedulerModule } from '@/server/services/taskScheduler';

const log = debug('task-lifecycle');

const TERMINAL_STATUSES = new Set(['canceled', 'completed', 'failed']);
const isTerminal = (status: string) => TERMINAL_STATUSES.has(status);

// Consecutive 'error' reasons after which we stop re-arming and let the
// urgent brief surface for human attention. Hardcoded for now (per LOBE-8233);
// move to task.config later if it needs to be tunable per-task.
const HEARTBEAT_FAILURE_FUSE = 3;

export interface TopicCompleteParams {
  errorMessage?: string;
  lastAssistantContent?: string;
  operationId: string;
  reason: string; // 'done' | 'error' | 'interrupted' | ...
  taskId: string;
  taskIdentifier: string;
  topicId?: string;
}

/**
 * TaskLifecycleService handles task state transitions triggered by topic completion.
 * Used by both local onComplete hooks and production webhook callbacks.
 */
export class TaskLifecycleService {
  private briefModel: BriefModel;
  private db: LobeChatDatabase;
  private systemAgentService: SystemAgentService;
  private taskModel: TaskModel;
  private taskTopicModel: TaskTopicModel;
  private topicModel: TopicModel;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.taskModel = new TaskModel(db, userId);
    this.taskTopicModel = new TaskTopicModel(db, userId);
    this.briefModel = new BriefModel(db, userId);
    this.topicModel = new TopicModel(db, userId);
    this.systemAgentService = new SystemAgentService(db, userId);
  }

  /**
   * Handle topic completion — the core lifecycle method.
   *
   * Flow: updateHeartbeat → updateTopicStatus → handoff → review → checkpoint
   */
  async onTopicComplete(params: TopicCompleteParams): Promise<void> {
    const { taskId, taskIdentifier, topicId, reason, lastAssistantContent, errorMessage } = params;

    log('onTopicComplete: task=%s topic=%s reason=%s', taskIdentifier, topicId, reason);

    await this.taskModel.updateHeartbeat(taskId);

    const currentTask = await this.taskModel.findById(taskId);

    if (reason === 'done') {
      // 1. Update topic status
      if (topicId) await this.taskTopicModel.updateStatus(taskId, topicId, 'completed');

      // 2. Generate handoff summary + topic title
      if (topicId && lastAssistantContent) {
        await this.generateHandoff(
          taskId,
          taskIdentifier,
          topicId,
          lastAssistantContent,
          currentTask,
        );
      }

      // 3. Auto-review (if configured) — Judge is the trusted accept signal:
      //    when review passes, runAutoReview itself transitions the task to 'completed'.
      //    Returns true if it terminated the task (completed/paused for retry/etc.).
      const reviewTerminated =
        currentTask && topicId && lastAssistantContent
          ? await this.runAutoReview(
              taskId,
              taskIdentifier,
              topicId,
              lastAssistantContent,
              currentTask,
            )
          : false;

      if (reviewTerminated) return;

      // 4. Default post-tick transition.
      //    - Automation tasks (heartbeat / schedule) loop running ↔ scheduled, so
      //      a successful tick parks the task at 'scheduled' to wait for the next
      //      tick. They never auto-pause on success — only `reason === 'error'`
      //      below puts them in 'paused' for human attention.
      //    - Non-automation tasks fall back to the legacy "pause for user review"
      //      behavior: a 'result' brief from the agent is a *proposal* of
      //      completion, and the user must explicitly approve via the brief action
      //      to transition to 'completed'. Auto-complete only happens via the
      //      Judge path above.
      if (currentTask) {
        if (currentTask.automationMode) {
          await this.taskModel.updateStatus(taskId, 'scheduled', { error: null });
        } else if (this.taskModel.shouldPauseOnTopicComplete(currentTask)) {
          await this.taskModel.updateStatus(taskId, 'paused', { error: null });
        }
      }
    } else if (reason === 'error') {
      if (topicId) await this.taskTopicModel.updateStatus(taskId, topicId, 'failed');

      const topicSeq = currentTask?.totalTopics || '?';
      const topicRef = topicId ? ` #${topicSeq} (${topicId})` : '';

      await this.briefModel.create({
        actions: DEFAULT_BRIEF_ACTIONS['error'],
        priority: 'urgent',
        summary: `Execution failed: ${errorMessage || 'Unknown error'}`,
        taskId,
        title: `${taskIdentifier} topic${topicRef} error`,
        type: 'error',
      });

      await this.taskModel.updateStatus(taskId, 'paused');
    }

    // Heartbeat re-arm: re-read task state (status / context may have just
    // been mutated by the branches above) and decide whether to publish the
    // next tick.
    const finalTask = await this.taskModel.findById(taskId);
    if (finalTask) await this.maybeRearmHeartbeat(finalTask, reason);
  }

  /**
   * Re-arm the next heartbeat tick after `onTopicComplete`.
   *
   * Skips when:
   *   - task is not in heartbeat mode or has no positive interval
   *   - task hit a terminal status (completed / canceled / failed)
   *   - an unresolved urgent brief exists for this task (human is waiting)
   *   - consecutive failures hit the fuse threshold (gives up until the user
   *     resolves the urgent error brief)
   */
  private async maybeRearmHeartbeat(task: TaskItem, reason: string): Promise<void> {
    if (task.automationMode !== 'heartbeat') return;
    if (!task.heartbeatInterval || task.heartbeatInterval <= 0) return;
    if (isTerminal(task.status)) return;

    const ctx = (task.context as { scheduler?: TaskSchedulerContext } | null) ?? {};
    const sched = ctx.scheduler ?? {};
    let consecutiveFailures = sched.consecutiveFailures ?? 0;

    if (reason === 'error') {
      consecutiveFailures += 1;
      if (consecutiveFailures >= HEARTBEAT_FAILURE_FUSE) {
        log(
          'fuse blown: task=%s consecutiveFailures=%d — not re-arming',
          task.identifier,
          consecutiveFailures,
        );
        await this.taskModel.updateContext(task.id, {
          scheduler: { consecutiveFailures },
        });
        return;
      }
    } else if (reason === 'done') {
      consecutiveFailures = 0;
    }

    // Exclude `error` briefs from the human-waiting check: error briefs are
    // created on every error and are governed by the fuse counter above.
    // Without this exclusion, the urgent error brief from the *just-completed*
    // failure would block re-arm and the fuse threshold would be unreachable.
    if (await this.briefModel.hasUnresolvedUrgentByTask(task.id, { excludeTypes: ['error'] })) {
      log('skip re-arm: task=%s has unresolved urgent brief', task.identifier);
      await this.taskModel.updateContext(task.id, {
        scheduler: { consecutiveFailures },
      });
      return;
    }

    try {
      const scheduler = createTaskSchedulerModule();

      // Cancel any prior tick (defensive — we usually wouldn't have one
      // pending here, since the prior tick has already fired to bring us
      // into onTopicComplete).
      if (sched.tickMessageId) {
        await scheduler.cancelScheduled(sched.tickMessageId).catch(() => undefined);
      }

      const tickMessageId = await scheduler.scheduleNextTopic({
        delay: task.heartbeatInterval,
        taskId: task.id,
        userId: this.userId,
      });

      await this.taskModel.updateContext(task.id, {
        scheduler: {
          consecutiveFailures,
          scheduledAt: new Date().toISOString(),
          tickMessageId,
        },
      });

      log(
        're-armed task=%s delay=%ds messageId=%s',
        task.identifier,
        task.heartbeatInterval,
        tickMessageId,
      );
    } catch (e) {
      console.warn('[TaskLifecycle] re-arm failed:', e);
    }
  }

  /**
   * Generate handoff summary and update topic title via LLM.
   * Writes to task_topics handoff fields + updates topic title.
   */
  private async generateHandoff(
    taskId: string,
    taskIdentifier: string,
    topicId: string,
    lastAssistantContent: string,
    currentTask: any,
  ): Promise<void> {
    try {
      const { model, provider } = await (this.systemAgentService as any).getTaskModelConfig(
        'topic',
      );

      const payload = chainTaskTopicHandoff({
        lastAssistantContent,
        taskInstruction: currentTask?.instruction || '',
        taskName: currentTask?.name || taskIdentifier,
      });

      const modelRuntime = await initModelRuntimeFromDB(this.db, this.userId, provider);
      const result = await modelRuntime.generateObject(
        {
          messages: payload.messages as any[],
          model,
          schema: { name: 'task_topic_handoff', schema: TASK_TOPIC_HANDOFF_SCHEMA },
        },
        { metadata: { trigger: 'task-handoff' } },
      );

      const handoff = result as {
        keyFindings?: string[];
        nextAction?: string;
        summary?: string;
        title?: string;
      };

      // Update topic title
      if (handoff.title) {
        await this.topicModel.update(topicId, { title: handoff.title });
      }

      // Store handoff in task_topics dedicated fields
      await this.taskTopicModel.updateHandoff(taskId, topicId, handoff);

      log('handoff generated for topic %s: title=%s', topicId, handoff.title);
    } catch (e) {
      console.warn('[TaskLifecycle] handoff generation failed:', e);
    }
  }

  /**
   * Run auto-review if configured.
   *
   * Acts as a "Judge" accept signal: when review passes the task transitions to
   * `completed` here; when it fails, the task is paused for retry or human action.
   *
   * @returns true if this method terminated the task lifecycle (caller should not
   *          additionally pause/transition); false if review wasn't configured or
   *          a non-terminal path was taken.
   */
  private async runAutoReview(
    taskId: string,
    taskIdentifier: string,
    topicId: string,
    content: string,
    currentTask: any,
  ): Promise<boolean> {
    const reviewConfig = this.taskModel.getReviewConfig(currentTask);
    if (!reviewConfig?.enabled || !reviewConfig.rubrics?.length) return false;

    try {
      const topicLinks = await this.taskTopicModel.findByTaskId(taskId);
      const targetTopic = topicLinks.find((t) => t.topicId === topicId);
      const iteration = (targetTopic?.reviewIteration || 0) + 1;

      const reviewService = new TaskReviewService(this.db, this.userId);
      const reviewResult = await reviewService.review({
        content,
        iteration,
        judge: reviewConfig.judge || {},
        rubrics: reviewConfig.rubrics,
        taskName: currentTask.name || taskIdentifier,
      });

      log(
        'review result: task=%s passed=%s score=%d iteration=%d/%d',
        taskIdentifier,
        reviewResult.passed,
        reviewResult.overallScore,
        iteration,
        reviewConfig.maxIterations,
      );

      // Save review result to task_topics
      await this.taskTopicModel.updateReview(taskId, topicId, {
        iteration,
        passed: reviewResult.passed,
        score: reviewResult.overallScore,
        scores: reviewResult.rubricResults,
      });

      if (reviewResult.passed) {
        // Judge is a trusted accept signal — the brief is created already-resolved
        // (no actionable buttons in the UI) and the task transitions to 'completed'.
        const now = new Date();
        await this.briefModel.create({
          priority: 'info',
          resolvedAction: 'auto-judge-pass',
          resolvedAt: now,
          readAt: now,
          summary: `Review passed (score: ${reviewResult.overallScore}%, iteration: ${iteration}). ${content.slice(0, 150)}`,
          taskId,
          title: `${taskIdentifier} review passed`,
          type: 'result',
        });
        await this.taskModel.updateStatus(taskId, 'completed', { error: null });
        return true;
      }

      if (reviewConfig.autoRetry && iteration < reviewConfig.maxIterations) {
        await this.briefModel.create({
          priority: 'normal',
          summary: `Review failed (score: ${reviewResult.overallScore}%, iteration ${iteration}/${reviewConfig.maxIterations}). Auto-retrying...`,
          taskId,
          title: `${taskIdentifier} review failed, retrying`,
          type: 'insight',
        });

        // Pause so the webhook / polling loop can pick up and re-run
        await this.taskModel.updateStatus(taskId, 'paused', { error: null });
        return true;
      }

      // Max iterations reached — surface the (failed) result for human accept/retry.
      // Type is `result` so the user's `approve` action is treated as a terminal
      // accept signal (force-pass) by BriefService.resolve. Result briefs render
      // a fixed single-button UI, so no custom actions are persisted.
      await this.briefModel.create({
        priority: 'urgent',
        summary: `Review failed after ${iteration} iteration(s) (score: ${reviewResult.overallScore}%). Suggestions: ${reviewResult.suggestions?.join('; ') || 'none'}`,
        taskId,
        title: `${taskIdentifier} review failed — needs attention`,
        type: 'result',
      });
      await this.taskModel.updateStatus(taskId, 'paused', { error: null });
      return true;
    } catch (e) {
      console.warn('[TaskLifecycle] auto-review failed:', e);
      return false;
    }
  }
}
