import { isHeterogeneousAgentModelId } from '@lobechat/const';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { DocumentModel } from '@/database/models/document';
import { TaskModel } from '@/database/models/task';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { createVerifierAgentRunner } from './agentVerifier';
import {
  recordHeterogeneousDeliverableEvidence,
  startEvidenceSubmission,
} from './evidenceSubmission';
import { VerifyExecutorService } from './executor';
import { resolveVerifyModelConfig } from './modelConfig';
import { finalizeVerifyRun } from './settle';
import { VERIFY_ABANDONED_MS } from './staleness';
import { VerifyStatusService } from './statusService';
import { resolveTaskAcceptance } from './taskAcceptance';

const log = debug('lobe-server:verify-lifecycle');
const MAX_TASK_DOCUMENT_CHARS = 80_000;

export const resolveVerificationDeliverable = async (
  db: LobeChatDatabase,
  userId: string,
  deliverable: string,
  taskId?: string | null,
  workspaceId?: string,
): Promise<string> => {
  if (!taskId) return deliverable;

  const pinnedDocuments = await new TaskModel(db, userId, workspaceId).getPinnedDocuments(taskId);
  if (pinnedDocuments.length === 0) return deliverable;

  const documentModel = new DocumentModel(db, userId, workspaceId);
  const documents = await Promise.all(
    pinnedDocuments.map(({ documentId }) => documentModel.findById(documentId)),
  );
  const readableDocuments = documents.filter((document): document is NonNullable<typeof document> =>
    Boolean(document?.content),
  );
  if (readableDocuments.length === 0) return deliverable;

  const taskDocumentContent = readableDocuments
    .map(
      (document) =>
        `## Task document: ${document.title ?? document.id}\n\n${document.content ?? ''}`,
    )
    .join('\n\n');

  return [
    deliverable,
    '# Associated task deliverables',
    taskDocumentContent.slice(0, MAX_TASK_DOCUMENT_CHARS),
  ]
    .filter(Boolean)
    .join('\n\n');
};

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
const executeVerifyLifecycle = async (
  db: LobeChatDatabase,
  userId: string,
  params: RunVerifyOnCompletionParams,
  workspaceId?: string,
  evidenceSubmitted = false,
  throwOnError = false,
): Promise<void> => {
  try {
    const run = await new VerifyRunModel(db, userId, workspaceId).findByOperation(
      params.operationId,
    );

    // Opt-in gate: only runs with a confirmed plan.
    if (!run?.plan?.length || !run.planConfirmedAt) return;

    const op = await new AgentOperationModel(db, userId, workspaceId).findById(params.operationId);
    if (!op) {
      log('op %s missing, cannot run verify', params.operationId);
      return;
    }

    // The builder now captures Acceptance evidence inside the main run. When it
    // covered the whole plan, the post-run evidence turn has nothing left to
    // collect — it mounts the evidence tool exclusively, so all it could add is
    // a restatement of text already in the transcript, at the cost of a second
    // agent run.
    //
    // Coverage is per required criterion, not "any row exists": a builder that
    // evidenced one of three criteria has not finished collecting, and skipping
    // on its first submission would strand the other two at the structural gate
    // with no chance to supply what they ask for.
    if (op.taskId && !evidenceSubmitted) {
      const inRunEvidence = await new VerifyEvidenceModel(db, userId, workspaceId).listByRun(
        run.id,
      );
      const byCheckItem = new Map<string, Set<string>>();
      for (const row of inRunEvidence) {
        const types = byCheckItem.get(row.checkItemId) ?? new Set<string>();
        types.add(row.type);
        byCheckItem.set(row.checkItemId, types);
      }

      const uncovered = run.plan.filter((item) => {
        if (item.required === false) return false;
        const captured = byCheckItem.get(item.id);
        if (!captured?.size) return true;

        // A criterion that names the artifacts it needs is only covered once
        // each declared type is present.
        const declared = (item.verifierConfig as { requiredEvidence?: { type: string }[] })
          ?.requiredEvidence;
        return Array.isArray(declared)
          ? declared.some((required) => !captured.has(required.type))
          : false;
      });

      if (inRunEvidence.length > 0 && uncovered.length === 0) {
        log(
          'op %s covered every required criterion in-run (%d rows), skipping the evidence turn',
          params.operationId,
          inRunEvidence.length,
        );
        evidenceSubmitted = true;
      } else if (inRunEvidence.length > 0) {
        log(
          'op %s has partial in-run coverage (%d criteria still uncovered), running the evidence turn',
          params.operationId,
          uncovered.length,
        );
      }
    }

    if (op.taskId && !evidenceSubmitted) {
      const evidenceClaimed = await new VerifyRunModel(
        db,
        userId,
        workspaceId,
      ).claimEvidenceCollection(run.id);
      if (evidenceClaimed) {
        try {
          if (isHeterogeneousAgentModelId(op.model) || isHeterogeneousAgentModelId(op.provider)) {
            await recordHeterogeneousDeliverableEvidence({
              db,
              deliverable: params.deliverable,
              operation: op,
              plan: run.plan,
              userId,
              workspaceId,
            });
            evidenceSubmitted = true;
          } else {
            await startEvidenceSubmission({
              db,
              deliverable: params.deliverable,
              goal: params.goal,
              operation: op,
              plan: run.plan,
              userId,
              workspaceId,
            });
          }
        } catch (error) {
          await new VerifyRunModel(db, userId, workspaceId).updateStatus(run.id, 'planned');
          throw error;
        }
      }
      if (!evidenceSubmitted) return;
    }

    // Claim only after a task-bound builder has submitted evidence. Standalone
    // runs have no builder phase and enter verification directly.
    const claimed = await new VerifyStatusService(db, userId, workspaceId).claimVerifying(
      params.operationId,
      new Date(Date.now() - VERIFY_ABANDONED_MS),
    );
    if (!claimed) {
      // A queued evidence callback that finds an unfinished judge must remain
      // retryable. A later delivery either reclaims the stale run or observes
      // its terminal status and exits normally.
      if (evidenceSubmitted && run.status === 'verifying') {
        throw new Error(`Verification for operation "${params.operationId}" is still in progress`);
      }
      return;
    }

    // Task-bound runs may pin which agent verifies through its Acceptance policy.
    // Non-task runs leave it undefined → builtin fallback.
    let verifierAgentId: string | undefined;
    if (op.taskId) {
      const resolvedAcceptance = await resolveTaskAcceptance(db, userId, op.taskId, workspaceId);
      verifierAgentId = resolvedAcceptance?.config.verifierAgentId ?? undefined;
    }

    const modelConfig = await resolveVerifyModelConfig(
      db,
      userId,
      {
        parentModel: op.model,
        parentProvider: op.provider,
        verifierAgentId,
      },
      workspaceId,
    );
    const resolvedDeliverable = await resolveVerificationDeliverable(
      db,
      userId,
      params.deliverable,
      op.taskId,
      workspaceId,
    );
    const verificationGoal = params.goal || run.goal || '';

    const executor = new VerifyExecutorService(db, userId, workspaceId);
    await executor.execute({
      deliverable: resolvedDeliverable,
      goal: verificationGoal,
      modelConfig,
      operationId: params.operationId,
      // `agent`-type checks run as the task-pinned verify agent (or the builtin
      // one), which writes its verdict back via the submitVerifyResult tool.
      runVerifierAgent: createVerifierAgentRunner({
        db,
        deliverable: resolvedDeliverable,
        model: modelConfig.model,
        provider: modelConfig.provider,
        taskId: op.taskId,
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
          deliverable: resolvedDeliverable,
          goal: verificationGoal,
          modelConfig,
        },
      },
      workspaceId,
    );
  } catch (error) {
    log('runVerifyOnCompletion failed for op %s (non-fatal): %O', params.operationId, error);
    if (throwOnError) throw error;
  }
};

export const runVerifyOnCompletion = async (
  db: LobeChatDatabase,
  userId: string,
  params: RunVerifyOnCompletionParams,
  workspaceId?: string,
): Promise<void> => executeVerifyLifecycle(db, userId, params, workspaceId, false);

/** The only entry point allowed to advance a task run out of evidence collection. */
export const runVerifyAfterEvidenceSubmission = async (
  db: LobeChatDatabase,
  userId: string,
  params: RunVerifyOnCompletionParams,
  workspaceId?: string,
): Promise<void> => executeVerifyLifecycle(db, userId, params, workspaceId, true, true);
