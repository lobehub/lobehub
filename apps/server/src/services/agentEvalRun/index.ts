import type { LobeChatDatabase } from '@lobechat/database';

import type { AgentEvalRunModel } from '@/database/models/agentEval';

import { evaluateAndFinalizeRun } from './aggregate';
import { recordTrajectoryCompletion } from './completion';
import { createRun } from './createRun';
import { createEvalRunDeps } from './deps';
import { rejudgeRun } from './rejudge';
import { rerunUnverifiedCases } from './rerun';
import { executeResumedThreadTrajectory, executeResumedTrajectory } from './resumeExecution';
import { canResumeTrajectory, getResumableCases, resumeTrajectory } from './resumeTarget';
import {
  abortRun,
  checkAndHandleRunTimeout,
  deleteRun,
  getAgentDisplayInfo,
  getRunDetails,
  retryErrorCases,
  retrySingleCase,
} from './runLifecycle';
import {
  executeMultiThreadTrajectory,
  executeThreadTrajectory,
  recordThreadCompletion,
} from './thread';
import {
  claimRun,
  executeTrajectory,
  executeTrajectoryOnDemand,
  loadTrajectoryData,
} from './trajectory';
import type { EvalRunDeps } from './types';

export { RUN_CREATE_ID_CONFLICT } from './createRun';

/** The arguments a stage function takes after its `deps`. */
type StageArgs<F> = F extends (deps: EvalRunDeps, ...args: infer A) => unknown ? A : never;

export class AgentEvalRunService {
  /** The same instance as `deps.runModel`; kept as a field for callers that read it directly. */
  private readonly runModel: AgentEvalRunModel;
  private readonly deps: EvalRunDeps;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.deps = createEvalRunDeps(db, userId, workspaceId);
    this.runModel = this.deps.runModel;
  }

  createRun(...args: StageArgs<typeof createRun>) {
    return createRun(this.deps, ...args);
  }

  deleteRun(...args: StageArgs<typeof deleteRun>) {
    return deleteRun(this.deps, ...args);
  }

  abortRun(...args: StageArgs<typeof abortRun>) {
    return abortRun(this.deps, ...args);
  }

  retryErrorCases(...args: StageArgs<typeof retryErrorCases>) {
    return retryErrorCases(this.deps, ...args);
  }

  retrySingleCase(...args: StageArgs<typeof retrySingleCase>) {
    return retrySingleCase(this.deps, ...args);
  }

  rerunUnverifiedCases(...args: StageArgs<typeof rerunUnverifiedCases>) {
    return rerunUnverifiedCases(this.deps, ...args);
  }

  /**
   * Grade a finished run again with the current judge setup, reusing its
   * recorded trajectories (no model runs again).
   */
  rejudgeRun(...args: StageArgs<typeof rejudgeRun>) {
    return rejudgeRun(this.deps, ...args);
  }

  canResumeTrajectory(...args: StageArgs<typeof canResumeTrajectory>) {
    return canResumeTrajectory(this.deps, ...args);
  }

  /**
   * Batch-check which error/timeout cases in a run can be resumed.
   * Returns one entry per candidate case with canResume + optional reason.
   */
  getResumableCases(...args: StageArgs<typeof getResumableCases>) {
    return getResumableCases(this.deps, ...args);
  }

  resumeTrajectory(...args: StageArgs<typeof resumeTrajectory>) {
    return resumeTrajectory(this.deps, ...args);
  }

  /**
   * Resume a timed-out single-agent trajectory (pass@1).
   * Claims the runTopic via CAS (timeout → running) for idempotency, then
   * calls execAgent with resume=true so the runtime continues from parentMessageId.
   */
  executeResumedTrajectory(...args: StageArgs<typeof executeResumedTrajectory>) {
    return executeResumedTrajectory(this.deps, ...args);
  }

  /**
   * Resume a timed-out thread trajectory (pass@k).
   * Claims the runTopic via CAS (timeout → running) for idempotency, then
   * calls execAgent with resume=true so the runtime continues from parentMessageId.
   */
  executeResumedThreadTrajectory(...args: StageArgs<typeof executeResumedThreadTrajectory>) {
    return executeResumedThreadTrajectory(this.deps, ...args);
  }

  loadTrajectoryData(...args: StageArgs<typeof loadTrajectoryData>) {
    return loadTrajectoryData(this.deps, ...args);
  }

  executeTrajectory(...args: StageArgs<typeof executeTrajectory>) {
    return executeTrajectory(this.deps, ...args);
  }

  /**
   * Atomically claim a pending external run (pending -> running) and return
   * everything a worker needs: the run, its dataset, all test cases (each
   * exposing the dataset-native `metadata.caseId`), and the agent snapshot.
   * Throws when the run is not owned or not currently pending.
   */
  claimRun(...args: StageArgs<typeof claimRun>) {
    return claimRun(this.deps, ...args);
  }

  /**
   * External worker entry point: execute a single case of a claimed run by its
   * dataset-native `metadata.caseId` (falling back to the internal test case
   * id). Creates the Topic/RunTopic on demand (external runs pre-create none),
   * then runs the trajectory. Idempotent for terminal cases — the old RunTopic
   * association is replaced with a fresh Topic; an active case is rejected.
   */
  executeTrajectoryOnDemand(...args: StageArgs<typeof executeTrajectoryOnDemand>) {
    return executeTrajectoryOnDemand(this.deps, ...args);
  }

  /**
   * Execute a test case with K threads (for pass@k).
   * Creates K threads in the pre-existing topic, then triggers K run-thread-trajectory workflows.
   */
  executeMultiThreadTrajectory(...args: StageArgs<typeof executeMultiThreadTrajectory>) {
    return executeMultiThreadTrajectory(this.deps, ...args);
  }

  /**
   * Execute a single thread trajectory (for pass@k).
   * Calls execAgent with topicId + threadId, webhook points to on-thread-complete.
   */
  executeThreadTrajectory(...args: StageArgs<typeof executeThreadTrajectory>) {
    return executeThreadTrajectory(this.deps, ...args);
  }

  /**
   * Record a single thread's completion (for pass@k).
   * Evaluates the thread's messages, writes result to thread.metadata,
   * then checks if all K threads are done. If so, aggregates into RunTopic.
   */
  recordThreadCompletion(...args: StageArgs<typeof recordThreadCompletion>) {
    return recordThreadCompletion(this.deps, ...args);
  }

  getRunDetails(...args: StageArgs<typeof getRunDetails>) {
    return getRunDetails(this.deps, ...args);
  }

  getAgentDisplayInfo(...args: StageArgs<typeof getAgentDisplayInfo>) {
    return getAgentDisplayInfo(this.deps, ...args);
  }

  recordTrajectoryCompletion(...args: StageArgs<typeof recordTrajectoryCompletion>) {
    return recordTrajectoryCompletion(this.deps, ...args);
  }

  evaluateAndFinalizeRun = evaluateAndFinalizeRun;

  /**
   * Check each pending RunTopic individually against the per-case timeout.
   * If a topic's createdAt + timeout has elapsed, mark it as 'timeout' and write duration.
   * If all topics reach terminal state after this, finalize the run (aggregate metrics + mark completed).
   * Returns true if any state was changed.
   */
  checkAndHandleRunTimeout(...args: StageArgs<typeof checkAndHandleRunTimeout>) {
    return checkAndHandleRunTimeout(this.deps, ...args);
  }
}
