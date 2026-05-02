import { TaskIdentifier as TaskSkillIdentifier } from '@lobechat/builtin-skills';
import { BriefIdentifier } from '@lobechat/builtin-tool-brief';
import type { ExecAgentResult } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { TopicTrigger } from '@/const/topic';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';

import { buildTaskPrompt } from './buildTaskPrompt';

const log = debug('task-runner');

export interface RunTaskParams {
  continueTopicId?: string;
  extraPrompt?: string;
  taskId: string;
}

export interface RunTaskResult extends ExecAgentResult {
  taskId: string;
  taskIdentifier: string;
}

/**
 * TaskRunnerService — orchestrates a single Task run.
 *
 * Used by:
 *   - `task.run` TRPC mutation (user-triggered)
 *   - `heartbeat-tick` workflow handler (QStash self-rescheduling)
 */
export class TaskRunnerService {
  private briefModel: BriefModel;
  private db: LobeChatDatabase;
  private taskLifecycle: TaskLifecycleService;
  private taskModel: TaskModel;
  private taskTopicModel: TaskTopicModel;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.taskModel = new TaskModel(db, userId);
    this.taskTopicModel = new TaskTopicModel(db, userId);
    this.briefModel = new BriefModel(db, userId);
    this.taskLifecycle = new TaskLifecycleService(db, userId);
  }

  async runTask(params: RunTaskParams): Promise<RunTaskResult> {
    const { taskId: idOrIdentifier, continueTopicId, extraPrompt } = params;

    const task = await this.taskModel.resolve(idOrIdentifier);
    if (!task) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    // Track whether *this* invocation transitioned the task to 'running'. The
    // catch-block rollback must only fire when we own the running state —
    // otherwise an early failure (e.g. CONFLICT thrown because a concurrent
    // run is in flight) would clobber the in-flight run's status to 'paused'.
    let weSetRunning = false;

    try {
      if (!task.assigneeAgentId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Task has no assigned agent. Use --agent when creating or edit the task.',
        });
      }

      const existingTopics = await this.taskTopicModel.findByTaskId(task.id);

      if (continueTopicId) {
        const target = existingTopics.find((t) => t.topicId === continueTopicId);
        if (target?.status === 'running') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Topic ${continueTopicId} is already running.`,
          });
        }
      } else {
        const runningTopic = existingTopics.find((t) => t.status === 'running');
        if (runningTopic) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Task already has a running topic (${runningTopic.topicId}). Cancel it first or use --continue.`,
          });
        }
      }

      // Auto-detect and clean up timed-out topics
      if (task.lastHeartbeatAt && task.heartbeatTimeout) {
        const elapsed = (Date.now() - new Date(task.lastHeartbeatAt).getTime()) / 1000;
        if (elapsed > task.heartbeatTimeout) {
          await this.taskTopicModel.timeoutRunning(task.id);
        }
      }

      const prompt = await buildTaskPrompt(
        task,
        {
          briefModel: this.briefModel,
          taskModel: this.taskModel,
          taskTopicModel: this.taskTopicModel,
        },
        extraPrompt,
      );

      if (task.status !== 'running') {
        await this.taskModel.updateStatus(task.id, 'running', {
          error: null,
          startedAt: new Date(),
        });
        weSetRunning = true;
      } else if (task.error) {
        await this.taskModel.update(task.id, { error: null });
      }

      const agentRef = task.assigneeAgentId!;
      const isSlug = !agentRef.startsWith('agt_');

      const aiAgentService = new AiAgentService(this.db, this.userId);
      const taskId = task.id;
      const taskIdentifier = task.identifier;
      const taskLifecycle = this.taskLifecycle;
      const userId = this.userId;

      const checkpoint = this.taskModel.getCheckpointConfig(task);
      const reviewConfig = this.taskModel.getReviewConfig(task);
      // Default mode is 'auto' — brief synthesis happens programmatically in
      // TaskLifecycleService.synthesizeTopicBrief. 'agent' is an explicit
      // escape hatch that re-mounts the legacy createBrief tool surface.
      const briefMode = (
        (task.config as { brief?: { mode?: string } } | null)?.brief?.mode === 'agent'
          ? 'agent'
          : 'auto'
      ) as 'agent' | 'auto';
      const pluginIds = [TaskSkillIdentifier];
      // Mount BriefIdentifier (createBrief + requestCheckpoint) only in the
      // legacy 'agent' path; in 'auto' the agent must not also call
      // createBrief or we'd double up.
      if (briefMode === 'agent' && !reviewConfig?.enabled && checkpoint.onAgentRequest !== false) {
        pluginIds.push(BriefIdentifier);
      }

      const taskConfig = (task.config ?? {}) as Record<string, unknown>;

      log('runTask: %s (continue=%s)', taskIdentifier, continueTopicId);

      const result = await aiAgentService.execAgent({
        ...(isSlug ? { slug: agentRef } : { agentId: agentRef }),
        additionalPluginIds: pluginIds,
        ...(typeof taskConfig.model === 'string' && { model: taskConfig.model }),
        ...(typeof taskConfig.provider === 'string' && { provider: taskConfig.provider }),
        hooks: [
          {
            handler: async (event) => {
              await taskLifecycle.onTopicComplete({
                errorMessage: event.errorMessage,
                lastAssistantContent: event.lastAssistantContent,
                operationId: event.operationId,
                reason: event.reason || 'done',
                taskId,
                taskIdentifier,
                topicId: event.topicId,
              });
            },
            id: 'task-on-complete',
            type: 'onComplete' as const,
            webhook: {
              body: { taskId, taskIdentifier, userId },
              delivery: 'qstash' as const,
              url: '/api/workflows/task/on-topic-complete',
            },
          },
        ],
        prompt,
        taskId: task.id,
        title: extraPrompt ? extraPrompt.slice(0, 100) : task.name || task.identifier,
        trigger: TopicTrigger.RunTask,
        userInterventionConfig: { approvalMode: 'headless' },
        ...(continueTopicId && { appContext: { topicId: continueTopicId } }),
      });

      if (result.topicId) {
        if (continueTopicId) {
          await this.taskTopicModel.updateStatus(task.id, continueTopicId, 'running');
          await this.taskTopicModel.updateOperationId(task.id, continueTopicId, result.operationId);
          await this.taskModel.updateCurrentTopic(task.id, continueTopicId);
        } else {
          await this.taskModel.incrementTopicCount(task.id);
          await this.taskModel.updateCurrentTopic(task.id, result.topicId);
          await this.taskTopicModel.add(task.id, result.topicId, {
            operationId: result.operationId,
            seq: (task.totalTopics || 0) + 1,
          });
        }
      }

      await this.taskModel.updateHeartbeat(task.id);

      return {
        ...result,
        taskId: task.id,
        taskIdentifier: task.identifier,
      };
    } catch (error) {
      if (weSetRunning) {
        try {
          const failedTask = await this.taskModel.resolve(idOrIdentifier);
          if (failedTask && failedTask.status === 'running') {
            await this.taskModel.updateStatus(failedTask.id, 'paused', {
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        } catch {
          // Rollback itself failed, ignore
        }
      }

      throw error;
    }
  }
}
