import { chainTaskTopicHandoff, TASK_TOPIC_HANDOFF_SCHEMA } from '@lobechat/prompts';
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

const log = debug('task-lifecycle');

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

      // 3. Auto-review (if configured)
      if (currentTask && topicId && lastAssistantContent) {
        await this.runAutoReview(
          taskId,
          taskIdentifier,
          topicId,
          lastAssistantContent,
          currentTask,
        );
      }

      // 4. Check if agent delivered a result brief → auto-complete
      //    If the latest brief is type 'result' and no review is configured, complete the task
      const reviewConfig = currentTask ? this.taskModel.getReviewConfig(currentTask) : null;
      if (!reviewConfig?.enabled) {
        const briefs = await this.briefModel.findByTaskId(taskId);
        const latestBrief = briefs[0]; // sorted by createdAt desc
        if (latestBrief?.type === 'result') {
          await this.taskModel.updateStatus(taskId, 'completed', { error: null });
          return;
        }
      }

      // 5. Checkpoint — pause for user review
      if (currentTask && this.taskModel.shouldPauseOnTopicComplete(currentTask)) {
        await this.taskModel.updateStatus(taskId, 'paused', { error: null });
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
   * @returns true if auto-retry is in progress (caller should skip pause)
   */
  private async runAutoReview(
    taskId: string,
    taskIdentifier: string,
    topicId: string,
    content: string,
    currentTask: any,
  ): Promise<void> {
    const reviewConfig = this.taskModel.getReviewConfig(currentTask);
    if (!reviewConfig?.enabled || !reviewConfig.rubrics?.length) return;

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
        await this.briefModel.create({
          priority: 'info',
          summary: `Review passed (score: ${reviewResult.overallScore}%, iteration: ${iteration}). ${content.slice(0, 150)}`,
          taskId,
          title: `${taskIdentifier} review passed`,
          type: 'result',
        });
        return;
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
        return;
      }

      // Max iterations reached
      await this.briefModel.create({
        actions: [
          { key: 'retry', label: '🔄 重试', type: 'resolve' as const },
          { key: 'approve', label: '✅ 强制通过', type: 'resolve' as const },
          { key: 'feedback', label: '💬 修改意见', type: 'comment' as const },
        ],
        priority: 'urgent',
        summary: `Review failed after ${iteration} iteration(s) (score: ${reviewResult.overallScore}%). Suggestions: ${reviewResult.suggestions?.join('; ') || 'none'}`,
        taskId,
        title: `${taskIdentifier} review failed — needs attention`,
        type: 'decision',
      });
    } catch (e) {
      console.warn('[TaskLifecycle] auto-review failed:', e);
    }
  }
}
