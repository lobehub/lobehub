import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainGenerateBrief,
  chainJudgeBriefEmit,
  chainTaskTopicHandoff,
  GENERATE_BRIEF_PROMPT_VERSION,
  GENERATE_BRIEF_SCHEMA,
  GENERATE_BRIEF_SCHEMA_NAME,
  JUDGE_BRIEF_EMIT_PROMPT_VERSION,
  JUDGE_BRIEF_EMIT_SCHEMA,
  JUDGE_BRIEF_EMIT_SCHEMA_NAME,
  TASK_TOPIC_HANDOFF_PROMPT_VERSION,
  TASK_TOPIC_HANDOFF_SCHEMA,
  TASK_TOPIC_HANDOFF_SCHEMA_NAME,
} from '@lobechat/prompts';
import type {
  BriefArtifacts,
  BriefDecision,
  TaskItem,
  TaskSchedulerContext,
  TaskTopicHandoff,
} from '@lobechat/types';
import { DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';
import debug from 'debug';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { SystemAgentService } from '@/server/services/systemAgent';
import { TaskResultBridgeService } from '@/server/services/taskResultBridge';
import { createTaskSchedulerModule } from '@/server/services/taskScheduler';

import {
  isTrivialAssistantContent,
  selectBriefPriority,
  selectBriefType,
  shouldEmitTopicBrief,
} from './synthesize';

/**
 * Read the brief generation mode from `task.config.brief.mode`.
 *
 * Defaults to `'auto'` — programmatic synthesis in `synthesizeTopicBrief`
 * is the standard path. `'agent'` is an explicit escape hatch that re-enables
 * the legacy agent-driven `createBrief` tool flow.
 */
const getBriefMode = (task: TaskItem | null): 'agent' | 'auto' => {
  const mode = (task?.config as { brief?: { mode?: string } } | null)?.brief?.mode;
  return mode === 'agent' ? 'agent' : 'auto';
};

const log = debug('task-lifecycle');

const TERMINAL_STATUSES = new Set(['canceled', 'completed', 'failed']);
const isTerminal = (status: string) => TERMINAL_STATUSES.has(status);

// Consecutive 'error' reasons after which we stop re-arming and let the
// urgent brief surface for human attention. Hardcoded for now (per );
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

  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.taskTopicModel = new TaskTopicModel(db, userId, workspaceId);
    this.briefModel = new BriefModel(db, userId, workspaceId);
    this.topicModel = new TopicModel(db, userId, workspaceId);
    this.systemAgentService = new SystemAgentService(db, userId, workspaceId);
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

    // Whether a confirmed verify plan owns this run's delivery acceptance. Set in
    // the 'done' branch; gates both the pause-for-review skip and (below) the
    // creator callback — for verify-bound runs the callback is deferred to the
    // verify settle path (driveTaskFromVerify) so the creator never consumes an
    // output before verify has accepted it.
    let verifyBound = false;

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

      // 3. Delivery acceptance now runs through Verify (LOBE-10624): the verify
      //    run settles asynchronously (agent verifier) and drives the task to its
      //    terminal state via `driveTaskFromVerify`. The legacy eval-rubric
      //    auto-review is removed; this branch only lets the task go on to the
      //    brief + post-tick transition, and the verify-bound check below makes it
      //    "let go" so verify owns the completion decision.

      // 4. Synthesize a programmatic brief for the user (auto mode only).
      //    The agent-driven `createBrief` tool path stays the default until
      //    the GrowthBook flag flips. See for the rollout plan.
      if (getBriefMode(currentTask) === 'auto' && currentTask && topicId && lastAssistantContent) {
        await this.synthesizeTopicBrief(
          taskId,
          taskIdentifier,
          topicId,
          lastAssistantContent,
          reason,
          currentTask,
        );
      }

      // 5. Default post-tick transition.
      //    - Schedule-mode task that just consumed its final allowed run
      //      (count ≥ maxExecutions) → park at 'completed' so the UI reflects
      //      the cap immediately. Without this, a daily cron with
      //      maxExecutions=1 would advertise itself as 'scheduled' for
      //      another 24h before the pre-tick check in runScheduleTick
      //      noticed.
      //    - Other automation tasks (heartbeat, schedule under cap) loop
      //      running ↔ scheduled, so a successful tick parks them at
      //      'scheduled' to wait for the next tick. They never auto-pause
      //      on success — only `reason === 'error'` below puts them in
      //      'paused' for human attention.
      //    - Non-automation tasks fall back to the legacy "pause for user
      //      review" behavior: a 'result' brief from the agent is a
      //      *proposal* of completion, and the user must explicitly approve
      //      via the brief action to transition to 'completed'. Auto-complete
      //      only happens via the Judge path above.
      // "Let go" for verify-bound runs: when a confirmed verify plan exists for
      // this op, delivery acceptance is decided asynchronously by Verify
      // (driveTaskFromVerify completes / pauses the task on settle), so we must
      // NOT pause-for-review here — the task stays running until verify settles.
      // Best-effort: a verify-read failure must never break the task lifecycle.
      try {
        const verifyRun = await new VerifyRunModel(
          this.db,
          this.userId,
          this.workspaceId,
        ).findByOperation(params.operationId);
        verifyBound = Boolean(verifyRun?.planConfirmedAt);
      } catch (error) {
        log('verify-bound check failed for op=%s (non-fatal): %O', params.operationId, error);
      }

      if (currentTask) {
        if (
          currentTask.automationMode === 'schedule' &&
          (await this.scheduleCapReached(currentTask))
        ) {
          log('cap reached for task=%s — marking completed post-tick', taskIdentifier);
          await this.taskModel.updateStatus(taskId, 'completed', { completedAt: new Date() });
        } else if (currentTask.automationMode) {
          await this.taskModel.updateStatus(taskId, 'scheduled', { error: null });
        } else if (!verifyBound && this.taskModel.shouldPauseOnTopicComplete(currentTask)) {
          await this.taskModel.updateStatus(taskId, 'paused', { error: null });
        }
      }
    } else if (reason === 'error') {
      if (topicId) await this.taskTopicModel.updateStatus(taskId, topicId, 'failed');

      const topicSeq = currentTask?.totalTopics || '?';
      const topicRef = topicId ? ` #${topicSeq} (${topicId})` : '';

      await this.briefModel.create({
        actions: DEFAULT_BRIEF_ACTIONS['error'],
        agentId: currentTask?.assigneeAgentId || undefined,
        priority: 'urgent',
        summary: `Execution failed: ${errorMessage || 'Unknown error'}`,
        taskId,
        title: `${taskIdentifier} topic${topicRef} error`,
        trigger: 'task',
        type: 'error',
      });

      await this.taskModel.updateStatus(taskId, 'paused');
    }

    // Bridge the finished task's handoff back to the creator conversation
    // (LOBE-10625). Runs HERE — after all status transitions above — so the
    // bridge reads the settled task status. Doing it as a separate webhook
    // racing `on-topic-complete` could observe the pre-transition status and
    // silently drop the only callback for automation tasks that become terminal
    // in this path (e.g. a scheduled task hitting its execution cap).
    //
    // Verify-bound runs DEFER the callback to the verify settle path
    // (driveTaskFromVerify): the delivery isn't accepted until verify settles, so
    // the creator must not receive/act on the output here — if verify later fails,
    // the unaccepted output would already have been consumed.
    if (!verifyBound) await this.bridgeResultToCreator(params);

    // Heartbeat re-arm: re-read task state (status / context may have just
    // been mutated by the branches above) and decide whether to publish the
    // next tick.
    const finalTask = await this.taskModel.findById(taskId);
    if (finalTask) await this.maybeRearmHeartbeat(finalTask, reason);
  }

  /**
   * Deliver the finished task's result back to the conversation that created
   * it. Always best-effort: a bridge failure must never affect task status, so
   * it's wrapped here and the underlying service also avoids throwing.
   */
  private async bridgeResultToCreator(params: TopicCompleteParams): Promise<void> {
    try {
      await new TaskResultBridgeService(this.db, this.userId, this.workspaceId).deliver({
        errorMessage: params.errorMessage,
        lastAssistantContent: params.lastAssistantContent,
        operationId: params.operationId,
        reason: params.reason,
        taskId: params.taskId,
        taskIdentifier: params.taskIdentifier,
        topicId: params.topicId,
      });
    } catch (error) {
      log('result bridge failed for task=%s (non-fatal): %O', params.taskIdentifier, error);
    }
  }

  /**
   * Has the task already consumed every allowed scheduled execution?
   *
   * Counts `task_topics` rows created since `context.scheduler.scheduleStartedAt`
   * (stamped by `TaskService.updateStatus` on user-initiated start/restart) and
   * compares against `config.schedule.maxExecutions`. Returns false when:
   *   - the task isn't in schedule mode
   *   - no cap is configured (null / 0)
   *   - no `scheduleStartedAt` is stamped (pre-PR tasks fall through; enforcement
   *     begins only after the user pauses + restarts)
   *
   * Mirrors the pre-tick check in `runScheduleTick` so a daily cron with
   * `maxExecutions=1` doesn't sit in `scheduled` for 24h after consuming
   * its single allowed run.
   */
  private async scheduleCapReached(task: TaskItem): Promise<boolean> {
    if (task.automationMode !== 'schedule') return false;
    const scheduleConfig =
      ((task.config as { schedule?: { maxExecutions?: number | null } } | null) ?? {}).schedule ??
      {};
    const maxExecutions = scheduleConfig.maxExecutions ?? null;
    if (maxExecutions == null || maxExecutions <= 0) return false;

    const scheduler =
      ((task.context as { scheduler?: { scheduleStartedAt?: string } } | null) ?? {}).scheduler ??
      {};
    const startedAtIso = scheduler.scheduleStartedAt;
    if (!startedAtIso) return false;

    const runCount = await this.taskTopicModel.countByTask(task.id, {
      since: new Date(startedAtIso),
    });
    return runCount >= maxExecutions;
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
      const [{ model, provider }, responseLanguage] = await Promise.all([
        (this.systemAgentService as any).getTaskModelConfig('topic'),
        this.systemAgentService.getUserLocale(),
      ]);

      const payload = chainTaskTopicHandoff({
        lastAssistantContent,
        responseLanguage,
        taskInstruction: currentTask?.instruction || '',
        taskName: currentTask?.name || taskIdentifier,
      });

      const modelRuntime = await initModelRuntimeFromDB(
        this.db,
        this.userId,
        provider,
        this.workspaceId,
      );
      const result = await modelRuntime.generateObject(
        {
          messages: payload.messages as any[],
          model,
          schema: { name: TASK_TOPIC_HANDOFF_SCHEMA_NAME, schema: TASK_TOPIC_HANDOFF_SCHEMA },
        },
        {
          metadata: { trigger: 'task_handoff' },
          tracing: {
            promptVersion: TASK_TOPIC_HANDOFF_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.TaskHandoff,
            schemaName: TASK_TOPIC_HANDOFF_SCHEMA_NAME,
          } satisfies TracingOptions,
        },
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
   * Programmatic brief synthesis for a completed topic.
   *
   * Fired only in `brief.mode === 'auto'` and only when neither the error nor
   * the judge path has already produced a brief. Two-stage decision:
   *  1. Rule layer (`shouldEmitTopicBrief`) — deterministic. Returns
   *     `'yes'` / `'no'` (caller persists the verdict and is done with the
   *     decision phase) or `'unknown'` (defer to LLM).
   *  2. LLM judge (`chainJudgeBriefEmit`) — semantic. Runs only on the
   *     `'unknown'` branch, returns `{emit, reason}` for content the rule
   *     can't classify (manual/non-scheduled topic with non-trivial output).
   *
   * The verdict (rule or LLM) is persisted to `taskTopics.handoff.briefDecision`
   * so the emit/skip outcome is auditable per topic. Generation
   * (`chainGenerateBrief`) is a separate LLM call that runs only when the
   * decision is `emit: true` — never wasting tokens drafting copy for a
   * brief that won't be persisted.
   *
   * Failures are swallowed — a missing brief should never block the task
   * lifecycle. The caller still proceeds to the post-tick state transition.
   */
  private async synthesizeTopicBrief(
    taskId: string,
    taskIdentifier: string,
    topicId: string,
    lastAssistantContent: string,
    reason: string,
    currentTask: TaskItem,
  ): Promise<void> {
    try {
      const reviewConfig = this.taskModel.getReviewConfig(currentTask);
      const decisionInput = {
        hasReviewConfigEnabled: !!reviewConfig?.enabled,
        isTrivialContent: isTrivialAssistantContent(lastAssistantContent),
        reason,
        // We've already returned upstream when reviewTerminated was true; the
        // remaining decision lives in shouldEmitTopicBrief itself.
        reviewTerminated: false,
        task: currentTask,
      };

      const ruleVerdict = shouldEmitTopicBrief(decisionInput);

      // Inputs needed by both the LLM judge (when ruleVerdict === 'unknown')
      // and by chainGenerateBrief (when emit ends up true). Hoisted so we
      // only fetch them once.
      const topicLink = await this.taskTopicModel.findByTopicId(topicId);
      const topicStartedAt = topicLink?.createdAt ?? new Date(0);
      const pinnedDocs = await this.taskModel.getDocumentsPinnedSince(taskId, topicStartedAt);
      const artifacts: BriefArtifacts = { documents: pinnedDocs };
      const handoff = (topicLink?.handoff as TaskTopicHandoff | null) ?? null;

      const [{ model, provider }, responseLanguage] = await Promise.all([
        (this.systemAgentService as any).getTaskModelConfig('topic'),
        this.systemAgentService.getUserLocale(),
      ]);

      let decision: BriefDecision;
      if (ruleVerdict.emit === 'unknown') {
        // Rule can't decide — ask the LLM judge. Title/summary are NOT
        // produced here; they come from chainGenerateBrief if emit=true.
        const judgePayload = chainJudgeBriefEmit({
          artifacts,
          handoff,
          lastAssistantContent,
          taskInstruction: currentTask.instruction || '',
          taskName: currentTask.name || taskIdentifier,
        });

        const modelRuntime = await initModelRuntimeFromDB(
          this.db,
          this.userId,
          provider,
          this.workspaceId,
        );
        const judgeResult = (await modelRuntime.generateObject(
          {
            messages: judgePayload.messages as any[],
            model,
            schema: { name: JUDGE_BRIEF_EMIT_SCHEMA_NAME, schema: JUDGE_BRIEF_EMIT_SCHEMA },
          },
          {
            metadata: { trigger: 'task_brief_judge' },
            tracing: {
              promptVersion: JUDGE_BRIEF_EMIT_PROMPT_VERSION,
              scenario: TRACING_SCENARIOS.TaskBriefJudge,
              schemaName: JUDGE_BRIEF_EMIT_SCHEMA_NAME,
            } satisfies TracingOptions,
          },
        )) as { emit?: boolean; reason?: string };

        decision = {
          decidedAt: new Date().toISOString(),
          emit: judgeResult.emit === true,
          model,
          reason: judgeResult.reason || 'llm-judge-unknown',
          source: 'llm-judge',
        };
      } else {
        decision = {
          decidedAt: new Date().toISOString(),
          emit: ruleVerdict.emit === 'yes',
          reason: ruleVerdict.reason,
          source: 'rule',
        };
      }

      // Persist the decision regardless of outcome — gives the operator a
      // per-topic audit trail of why a brief was or wasn't produced.
      await this.taskTopicModel.updateBriefDecision(taskId, topicId, decision);

      if (!decision.emit) {
        log(
          'synthesize: skip task=%s topic=%s source=%s reason=%s',
          taskIdentifier,
          topicId,
          decision.source,
          decision.reason,
        );
        return;
      }

      const briefType = selectBriefType(decisionInput);
      const priority = selectBriefPriority(decisionInput);

      const payload = chainGenerateBrief({
        artifacts,
        handoff,
        lastAssistantContent,
        responseLanguage,
        taskInstruction: currentTask.instruction || '',
        taskName: currentTask.name || taskIdentifier,
      });

      const modelRuntime = await initModelRuntimeFromDB(
        this.db,
        this.userId,
        provider,
        this.workspaceId,
      );
      const result = await modelRuntime.generateObject(
        {
          messages: payload.messages as any[],
          model,
          schema: { name: GENERATE_BRIEF_SCHEMA_NAME, schema: GENERATE_BRIEF_SCHEMA },
        },
        {
          metadata: { trigger: 'task_brief' },
          tracing: {
            promptVersion: GENERATE_BRIEF_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.TaskBrief,
            schemaName: GENERATE_BRIEF_SCHEMA_NAME,
          } satisfies TracingOptions,
        },
      );

      const generated = result as { summary?: string; title?: string };
      if (!generated.title || !generated.summary) {
        log(
          'synthesize: LLM returned empty title/summary task=%s topic=%s',
          taskIdentifier,
          topicId,
        );
        return;
      }

      // `result` briefs render a fixed approval UI and intentionally have no
      // default actions — see DEFAULT_BRIEF_ACTIONS comment.
      const actions = briefType === 'result' ? null : (DEFAULT_BRIEF_ACTIONS[briefType] ?? null);

      await this.briefModel.create({
        actions,
        agentId: currentTask.assigneeAgentId || undefined,
        artifacts,
        priority,
        summary: generated.summary,
        taskId,
        title: generated.title,
        topicId,
        trigger: 'task',
        type: briefType,
      });

      log('synthesize: brief created task=%s topic=%s type=%s', taskIdentifier, topicId, briefType);
    } catch (e) {
      console.warn('[TaskLifecycle] brief synthesis failed:', e);
    }
  }
}
