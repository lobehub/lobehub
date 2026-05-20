import { TaskIdentifier as TaskSkillIdentifier } from '@lobechat/builtin-skills';
import { BriefIdentifier } from '@lobechat/builtin-tool-brief';
import { INBOX_SESSION_ID } from '@lobechat/const';
import type { ExecAgentResult, TaskItem } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { TopicTrigger } from '@/const/topic';
import { AgentModel } from '@/database/models/agent';
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
  private agentModel: AgentModel;
  private briefModel: BriefModel;
  private db: LobeChatDatabase;
  private taskLifecycle: TaskLifecycleService;
  private taskModel: TaskModel;
  private taskTopicModel: TaskTopicModel;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.agentModel = new AgentModel(db, userId);
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
        const inboxAgent = await this.agentModel.getBuiltinAgent(INBOX_SESSION_ID);
        if (!inboxAgent) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to resolve fallback inbox agent for task',
          });
        }
        await this.taskModel.update(task.id, { assigneeAgentId: inboxAgent.id });
        task.assigneeAgentId = inboxAgent.id;
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

      // Backfill model snapshot for tasks created before the snapshot logic
      // landed, or whose assignee was set after creation. Once written, the
      // task is pinned to this model regardless of later agent default changes.
      if (typeof taskConfig.model !== 'string' || typeof taskConfig.provider !== 'string') {
        const snapshot = await this.agentModel.getAgentModelConfig(agentRef);
        if (snapshot) {
          await this.taskModel.updateTaskConfig(task.id, snapshot);
          taskConfig.model = snapshot.model;
          taskConfig.provider = snapshot.provider;
        }
      }

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

  /**
   * Result of cascading kickoff after a task transitions to `completed`.
   * Mirrors the legacy unlock-only response so callers can keep their
   * payload shape unchanged.
   */
  static cascadeEmpty(): CascadeResult {
    return { failed: [], paused: [], started: [] };
  }

  /**
   * After a task transitions to `completed`, find downstream tasks whose
   * dependencies are now fully met and *actually run them*.
   *
   * Why this matters: the legacy code path flipped unlocked tasks to `running`
   * in the DB but never created a topic — so they appeared running while no
   * agent execution was in flight. This method bridges the gap.
   *
   * - Honors parent `beforeIds` checkpoints by leaving such tasks `paused`.
   * - If `runTask` throws (e.g. no assignee), the task is left in `paused`
   *   with the error recorded — the same fallback used by the runner itself.
   */
  async cascadeOnCompletion(completedTaskId: string): Promise<CascadeResult> {
    const unlocked = await this.taskModel.getUnlockedTasks(completedTaskId);
    if (unlocked.length === 0) return TaskRunnerService.cascadeEmpty();

    const result: CascadeResult = { failed: [], paused: [], started: [] };

    for (const task of unlocked) {
      if (await this.shouldHoldForCheckpoint(task)) {
        await this.taskModel.updateStatus(task.id, 'paused');
        result.paused.push(task.identifier);
        continue;
      }

      try {
        await this.runTask({ taskId: task.id });
        result.started.push(task.identifier);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start task';
        log('cascadeOnCompletion: runTask failed for %s: %s', task.identifier, message);
        // Best-effort: mark as paused so the user can see why it didn't run.
        try {
          await this.taskModel.updateStatus(task.id, 'paused', { error: message });
        } catch {
          /* ignore — surfaced via failed list */
        }
        result.failed.push({ error: message, identifier: task.identifier });
      }
    }

    return result;
  }

  private async shouldHoldForCheckpoint(task: TaskItem): Promise<boolean> {
    if (!task.parentTaskId) return false;
    const parent = await this.taskModel.findById(task.parentTaskId);
    if (!parent) return false;
    return this.taskModel.shouldPauseBeforeStart(parent, task.identifier);
  }
}

export interface CascadeResult {
  /** Tasks where kickoff threw and were marked paused with an error. */
  failed: { error: string; identifier: string }[];
  /** Tasks held back by a parent's `beforeIds` checkpoint. */
  paused: string[];
  /** Tasks that were successfully kicked off (topic created). */
  started: string[];
}
