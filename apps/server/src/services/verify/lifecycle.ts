import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { createVerifierAgentRunner } from './agentVerifier';
import { VerifyExecutorService } from './executor';
import { finalizeVerifyRun } from './settle';

const log = debug('lobe-server:verify-lifecycle');

export interface RunVerifyOnCompletionParams {
  /** The run's final output / artifacts, judged against the plan. */
  deliverable: string;
  /** The user's task the run had to satisfy. */
  goal: string;
  operationId: string;
}

/**
 * Completion-side entry point for the delivery checker. Called fire-and-forget
 * from the agent runtime when an operation terminates successfully. Runs the
 * confirmed check plan (LLM judge inline), then attempts auto-repair.
 *
 * Guarded so it only acts on runs that opted in (a confirmed plan exists) and
 * never throws — verification must not affect the run's own lifecycle.
 *
 * Note: agent-type verifiers and auto-repair spawning require full runtime
 * context (sub-operation forking); they are injected seams. Without a spawner
 * those items degrade gracefully (skipped / no repair).
 */
export const runVerifyOnCompletion = async (
  db: LobeChatDatabase,
  userId: string,
  params: RunVerifyOnCompletionParams,
  workspaceId?: string,
): Promise<void> => {
  try {
    const run = await new VerifyRunModel(db, userId, workspaceId).findByOperation(
      params.operationId,
    );

    // Opt-in gate: only runs with a confirmed plan that hasn't been verified yet.
    if (!run?.plan?.length || !run.planConfirmedAt) return;
    if (run.status !== 'planned') return;

    const op = await new AgentOperationModel(db, userId, workspaceId).findById(params.operationId);
    if (!op?.model || !op?.provider) {
      log('op %s missing model/provider, cannot run verify', params.operationId);
      return;
    }

    // Task-bound runs may pin which agent verifies (TaskVerifyConfig.verifierAgentId,
    // with subtask inheritance). Non-task runs leave it undefined → builtin fallback.
    let verifierAgentId: string | undefined;
    if (op.taskId) {
      const verifyConfig = await new TaskModel(db, userId, workspaceId).resolveVerifyConfig(
        op.taskId,
      );
      verifierAgentId = verifyConfig?.verifierAgentId ?? undefined;
    }

    const executor = new VerifyExecutorService(db, userId, workspaceId);
    await executor.execute({
      deliverable: params.deliverable,
      goal: params.goal,
      modelConfig: { model: op.model, provider: op.provider },
      operationId: params.operationId,
      // `agent`-type checks run as the task-pinned verify agent (or the builtin
      // one), which writes its verdict back via the submitVerifyResult tool.
      runVerifierAgent: createVerifierAgentRunner({
        db,
        deliverable: params.deliverable,
        model: op.model,
        provider: op.provider,
        topicId: op.topicId,
        userId,
        verifierAgentId,
        workspaceId,
      }),
    });

    // Settle the run: repair-aware tail, then (on terminal settle) report + drive
    // the bound task. For inline (LLM/program) checks everything is resolved now;
    // runs with async agent checks no-op here and re-enter the same finalizer from
    // the verifier's writeback path (verifyResult runtime) — so the task is driven
    // from exactly one place regardless of which path finished last.
    await finalizeVerifyRun(
      db,
      userId,
      params.operationId,
      {
        report: {
          deliverable: params.deliverable,
          goal: params.goal,
          modelConfig: { model: op.model, provider: op.provider },
        },
      },
      workspaceId,
    );
  } catch (error) {
    log('runVerifyOnCompletion failed for op %s (non-fatal): %O', params.operationId, error);
  }
};
