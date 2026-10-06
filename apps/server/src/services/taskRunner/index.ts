import { TaskIdentifier as TaskSkillIdentifier } from '@lobechat/builtin-skills';
import { AcceptanceEvidenceIdentifier } from '@lobechat/builtin-tool-acceptance-evidence';
import { BriefIdentifier } from '@lobechat/builtin-tool-brief';
import { INBOX_SESSION_ID } from '@lobechat/const';
import type { ExecAgentResult, TaskItem, TaskRunTrigger } from '@lobechat/types';
import { getHeterogeneousNativeModelProvider, readTaskExecutionConfig } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { TopicTrigger } from '@/const/topic';
import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { resolveFailedRunStatus } from '@/server/services/goal/recoveryPolicy';
import { resolveMissingTaskModelConfig } from '@/server/services/task/modelSnapshot';
import { createTaskRunHooks } from '@/server/services/task/runHooks';

import { buildTaskPrompt } from './buildTaskPrompt';
import {
  resolveRunDeviceId,
  resolveTaskRunExecution,
  resolveTopicExecutionPatch,
} from './resolveRunExecution';

const log = debug('task-runner');

export interface RunTaskParams {
  /** Extra builtin tools this run mounts beside the Task skill, e.g. the Goal report tool. */
  additionalPluginIds?: string[];
  continueTopicId?: string;
  /** Explicit device target for this run only. The Task itself does not retain the binding. */
  deviceId?: string;
  extraPrompt?: string;
  /** Optional per-operation cap. Omitted means the agent runtime remains uncapped. */
  maxSteps?: number;
  taskId: string;
  /**
   * What triggered this run. Defaults to `'manual'` — the ad-hoc "run now"
   * path (TRPC `task.run`, agent `runTask` tool). The scheduler ticks pass
   * `'schedule'` / `'heartbeat'` so the lifecycle can tell an ad-hoc run apart
   * from an automation tick ().
   */
  trigger?: TaskRunTrigger;
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
  private taskModel: TaskModel;
  private taskTopicModel: TaskTopicModel;
  private topicModel: TopicModel;
  private userId: string;

  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.agentModel = new AgentModel(db, userId, workspaceId);
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.taskTopicModel = new TaskTopicModel(db, userId, workspaceId);
    this.topicModel = new TopicModel(db, userId, workspaceId);
    this.briefModel = new BriefModel(db, userId, workspaceId);
  }

  /**
   * Mirror a task's execution selection onto a topic one of its runs continues.
   *
   * Deliberately NOT swallowed: the topic's stored directory outranks the
   * selection this run brings, so an unsynced topic means the run may start in
   * the previous machine's directory — failing the kickoff (and letting the
   * caller's error path restore the task's resting state) is better than
   * running somewhere the user did not pin.
   */
  private async syncTopicExecution(
    topicId: string,
    taskConfig: Record<string, unknown>,
    runDeviceId: string | undefined,
  ): Promise<void> {
    const topic = await this.topicModel.findById(topicId);
    const patch = resolveTopicExecutionPatch(topic?.metadata, taskConfig, runDeviceId);
    if (!patch) return;

    await this.topicModel.updateMetadata(topicId, patch);
    log('runTask: synced topic %s execution metadata', topicId);
  }

  async runTask(params: RunTaskParams): Promise<RunTaskResult> {
    const {
      additionalPluginIds,
      taskId: idOrIdentifier,
      continueTopicId,
      deviceId,
      extraPrompt,
      maxSteps,
      trigger = 'manual',
    } = params;

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
        // A human-assigned task still executes via the inbox agent, but the
        // fallback must stay ephemeral — persisting it would silently replace
        // the member assignment on the first run.
        if (!task.assigneeUserId) {
          // Goes through the logging path like every other assignee write: the
          // chip visibly flips from unassigned to the inbox agent, so the feed
          // has to be able to say who did it. No actor — nobody asked for this
          // one, the runner needed an agent to execute with.
          await this.taskModel.updateWithLog(task.id, { assigneeAgentId: inboxAgent.id }, {});
        }
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

      const {
        acceptanceEnabled,
        fileIds: attachmentFileIds,
        prompt,
      } = await buildTaskPrompt(
        task,
        {
          briefModel: this.briefModel,
          db: this.db,
          taskModel: this.taskModel,
          taskTopicModel: this.taskTopicModel,
          userId: this.userId,
          workspaceId: this.workspaceId,
        },
        extraPrompt,
      );

      if (task.status !== 'running') {
        // Conditional on the status read above: a task deleted (or started by
        // another caller) in the meantime must not get an agent dispatched.
        const started = await this.taskModel.updateStatusIfCurrent(
          task.id,
          task.status,
          'running',
          { error: null, startedAt: new Date() },
        );
        if (!started) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'The task changed or was deleted before its run could start.',
          });
        }
        weSetRunning = true;
      } else if (task.error) {
        await this.taskModel.update(task.id, { error: null });
      }

      const agentRef = task.assigneeAgentId!;
      const isSlug = !agentRef.startsWith('agt_');

      const aiAgentService = new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      });
      const taskIdentifier = task.identifier;

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
      // The Acceptance runs inside the Task, so the builder needs listCriteria +
      // submitEvidence for the whole run — not only in the post-run evidence
      // turn, which mounts this tool exclusively and therefore can only ever
      // restate text it already wrote.
      if (acceptanceEnabled) pluginIds.push(AcceptanceEvidenceIdentifier);
      if (additionalPluginIds) pluginIds.push(...additionalPluginIds);

      const taskConfig = (task.config ?? {}) as Record<string, unknown>;

      // Backfill model snapshot for tasks created before the snapshot logic
      // landed, or whose assignee was set after creation. Once written, the
      // task is pinned to this model regardless of later agent default changes.
      // Only missing fields are filled: a legacy model-only override keeps its model.
      if (typeof taskConfig.model !== 'string' || typeof taskConfig.provider !== 'string') {
        const snapshot = await this.agentModel.getAgentModelConfig(agentRef);
        if (snapshot) {
          const agencyConfig = await this.agentModel.getAgentAgencyConfig(agentRef);
          const missing = resolveMissingTaskModelConfig(
            taskConfig,
            snapshot,
            getHeterogeneousNativeModelProvider(agencyConfig?.heterogeneousProvider),
          );
          await this.taskModel.updateTaskConfig(task.id, missing);
          Object.assign(taskConfig, missing);
        }
      }

      // The execution selection the task itself carries — a pinned device and/or
      // a working directory. Undefined when the task pins nothing, in which case
      // the run keeps inheriting the assignee agent's target and cwd.
      const taskExecution = readTaskExecutionConfig(taskConfig);
      // The device the run will actually use. It differs from the task's pin
      // when the author FIXED the agent's target, and that difference decides
      // whether the directory may travel: see `resolveTaskRunExecution`.
      const runDeviceId = taskExecution
        ? resolveRunDeviceId(
            taskExecution,
            await this.agentModel.getAgentAgencyConfig(agentRef),
            this.workspaceId,
          )
        : undefined;
      const runExecution = resolveTaskRunExecution(taskExecution, runDeviceId);

      // A continued topic keeps its own metadata (`turnSetup` stamps
      // `initialTopicMetadata` only for a topic it creates) and those stored
      // values outrank what this run brings — the directory this task pins would
      // be ignored, and the previous machine's kept. Stamp the task's selection
      // onto the topic first; see `resolveTopicExecutionPatch`.
      if (continueTopicId) {
        await this.syncTopicExecution(continueTopicId, taskConfig, runDeviceId);
      }

      log('runTask: %s (continue=%s)', taskIdentifier, continueTopicId);

      const result = await aiAgentService.execAgent({
        ...(isSlug ? { slug: agentRef } : { agentId: agentRef }),
        additionalPluginIds: pluginIds,
        ...(deviceId && { deviceId }),
        ...(typeof taskConfig.model === 'string' && { model: taskConfig.model }),
        ...(typeof taskConfig.provider === 'string' && { provider: taskConfig.provider }),
        hooks: createTaskRunHooks({
          db: this.db,
          taskId: task.id,
          taskIdentifier: task.identifier,
          trigger,
          userId: this.userId,
          workspaceId: this.workspaceId,
        }),
        ...(attachmentFileIds.length > 0 ? { fileIds: attachmentFileIds } : {}),
        ...(maxSteps ? { maxSteps } : {}),
        prompt,
        taskId: task.id,
        title: extraPrompt ? extraPrompt.slice(0, 100) : task.name || task.identifier,
        trigger: TopicTrigger.RunTask,
        userInterventionConfig: { approvalMode: 'headless' },
        // The task's own pin, when it has one. `deviceId` forces device routing
        // unless the agent's selection policy is `fixed` (author-controlled
        // targets stay authoritative — same rule the chat picker follows), and
        // the directory rides into the topic this run creates.
        ...(runExecution?.deviceId ? { deviceId: runExecution.deviceId } : {}),
        ...(continueTopicId || runExecution?.initialTopicMetadata
          ? {
              appContext: {
                ...(continueTopicId && { topicId: continueTopicId }),
                // A continued topic keeps its own metadata (the server ignores
                // this for an existing topic), so it is only meaningful on a
                // fresh run — sent anyway so the task's intent is not lost if
                // that ever changes.
                ...(runExecution?.initialTopicMetadata && {
                  initialTopicMetadata: runExecution.initialTopicMetadata,
                }),
              },
            }
          : {}),
      });

      if (!result.success) {
        // execAgent reports a dispatch or startup failure as a result rather
        // than a throw (`startOperation`, `heteroDispatch`): the assistant
        // bubble already carries the error and the run's lifecycle hooks have
        // fired. Booking that dead operation as a running topic would leave
        // the Task looking in flight — a goal coordinator would even record a
        // `started_run` for it — with nothing left to ever settle it. Keep the
        // attempt visible as a failed run, then fail the kickoff like any other.
        if (result.topicId && !continueTopicId) {
          await this.taskModel.incrementTopicCount(task.id);
          await this.taskModel.updateCurrentTopic(task.id, result.topicId);
          await this.taskTopicModel.add(task.id, result.topicId, {
            operationId: result.operationId,
            seq: (task.totalTopics || 0) + 1,
            trigger,
          });
        }
        if (result.topicId) {
          await this.taskTopicModel.updateStatus(
            task.id,
            result.topicId,
            resolveFailedRunStatus(result.error),
          );
        }
        throw new Error(result.error || result.message || 'Agent run failed to start');
      }

      if (result.topicId) {
        const topicId = result.topicId;
        // Record the run under the task's row lock (see TaskService.deleteTask).
        // If the task was deleted — or canceled, e.g. by a Goal retiring its
        // node — while this run was being dispatched, whoever did it found no
        // topic to stop yet. Nobody else will stop it, so stop it here instead
        // of recording an operation that keeps running behind the cancellation.
        // A claim withdrawn mid-startup is the same case: closing or restarting
        // a goal puts a claimed Task with no recorded run back to `backlog`.
        const recorded = await this.db.transaction(async (tx) => {
          const taskModel = new TaskModel(tx, this.userId, this.workspaceId);
          const taskTopicModel = new TaskTopicModel(tx, this.userId, this.workspaceId);
          if (!(await taskModel.lockForUpdate(task.id))) return 'deleted' as const;
          const current = await taskModel.findById(task.id);
          if (current?.status === 'canceled') return 'canceled' as const;
          if (current?.status === 'backlog') return 'withdrawn' as const;
          if (continueTopicId) {
            await taskTopicModel.updateStatus(task.id, continueTopicId, 'running');
            await taskTopicModel.updateOperationId(task.id, continueTopicId, result.operationId);
            await taskModel.updateCurrentTopic(task.id, continueTopicId);
          } else {
            await taskModel.incrementTopicCount(task.id);
            await taskModel.updateCurrentTopic(task.id, topicId);
            await taskTopicModel.add(task.id, topicId, {
              operationId: result.operationId,
              seq: (task.totalTopics || 0) + 1,
              trigger,
            });
          }
          return 'recorded' as const;
        });
        if (recorded !== 'recorded') {
          const stop = await aiAgentService
            .interruptTask({ operationId: result.operationId })
            .catch((error) => {
              log('runTask: failed to stop orphaned run: %O', error);
              return undefined;
            });
          // Same confirmation gate as TaskService.interruptTaskOperation.
          const stopped = !!stop?.success && stop.deviceCancellationConfirmed !== false;
          throw new TRPCError({
            code: stopped
              ? recorded === 'deleted'
                ? 'NOT_FOUND'
                : 'CONFLICT'
              : 'INTERNAL_SERVER_ERROR',
            message: stopped
              ? `The task was ${recorded} while its run was starting; the run was stopped.`
              : `The task was ${recorded} while its run was starting, and stopping that run (operation ${result.operationId}) could not be confirmed.`,
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
            const errorText = error instanceof Error ? error.message : 'Unknown error';
            // A failed kickoff must not kill an automation task's schedule: the
            // scheduling state is not a per-run health signal. Restore the
            // resting 'scheduled' state so the next tick still fires (this is
            // the sync mirror of the async onTopicComplete error handling —
            //). Non-automation (ad-hoc / dependency) tasks keep
            // the legacy pause-for-attention behavior.
            if (failedTask.automationMode) {
              await this.taskModel.updateStatus(failedTask.id, 'scheduled', { error: errorText });
            } else {
              await this.taskModel.updateStatus(failedTask.id, 'paused', { error: errorText });
            }
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
    return this.cascadeOnCompletionMany([completedTaskId]);
  }

  /**
   * Batched variant of {@link cascadeOnCompletion} for family-wide status
   * cascades: dependents are discovered across all completed ids in one pass,
   * so completing N tasks costs a constant number of discovery queries instead
   * of N dependency walks.
   */
  async cascadeOnCompletionMany(completedTaskIds: string[]): Promise<CascadeResult> {
    const unlocked = await this.taskModel.getUnlockedTasksForMany(completedTaskIds);
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
