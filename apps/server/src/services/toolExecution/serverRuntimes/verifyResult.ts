import type { SubmitVerifyResultParams } from '@lobechat/builtin-tool-verify';
import { VerifyToolIdentifier } from '@lobechat/builtin-tool-verify';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';
import { finalizeVerifyRun, VerifyStatusService } from '@/server/services/verify';

import type { ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:verify-result-runtime');

/** Verdicts already landed (tool write or terminal fallback) — re-submission is a no-op. */
const TERMINAL_RESULT_STATUSES = new Set(['passed', 'failed', 'errored', 'skipped']);

interface VerifyResultRuntimeContext {
  operationId?: string;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * Server runtime for the verify-result tool. The verifier sub-agent calls
 * `submitVerifyResult` once it has judged its check; this writes the verdict back
 * to the PARENT run's `verify_check_results` row (resolved from the sub-op's
 * `parentOperationId`) and recomputes the parent's rollup status.
 */
class VerifyResultExecutionRuntime {
  private operationId?: string;
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(context: VerifyResultRuntimeContext) {
    this.operationId = context.operationId;
    this.db = context.serverDB;
    this.userId = context.userId;
    this.workspaceId = context.workspaceId;
  }

  submitVerifyResult = async (params: SubmitVerifyResultParams) => {
    if (!this.operationId) {
      return { content: 'No operation context.', error: 'NO_OPERATION', success: false };
    }
    if (!params?.checkItemId || !params?.verdict) {
      return {
        content: 'checkItemId and verdict are required.',
        error: 'INVALID_ARGUMENTS',
        success: false,
      };
    }

    // The verifier runs as a sub-agent; the row to update belongs to the parent run.
    const op = await new AgentOperationModel(this.db, this.userId, this.workspaceId).findById(
      this.operationId,
    );
    // Loud-fail instead of silently self-targeting: without the parent op there is
    // no verification session to update, so a derived id would always hit
    // "No verification session for this run." — an unactionable error for the
    // verifier. Naming the missing context is the actionable signal.
    if (!op) {
      return {
        content:
          'No parent verification context for this run: the calling operation has no parent, so there is no check to record against. This tool only records a verdict for a check assigned by a verify run.',
        error: 'NO_PARENT_VERIFICATION',
        success: false,
      };
    }
    const targetOperationId = op.parentOperationId;
    if (!targetOperationId) {
      // Same loud-fail contract as the missing parent above: without a parent
      // operation there is no verification session to record against, and a
      // `string | null` id must never reach the run lookup as `string`.
      return {
        content:
          'No parent verification context for this run: the calling operation has no parent, so there is no check to record against. This tool only records a verdict for a check assigned by a verify run.',
        error: 'NO_PARENT_VERIFICATION',
        success: false,
      };
    }
    const run = await new VerifyRunModel(this.db, this.userId, this.workspaceId).findByOperation(
      targetOperationId,
    );
    if (!run) {
      return {
        content:
          'No verification session is bound to the parent run, so there is no check to record against. This tool only records verdicts for checks assigned by a verify run — if your instructions did not include a checkItemId from a verify run, report your verdict in your reply instead.',
        error: 'NO_RUN',
        success: false,
      };
    }

    // Idempotent re-submission: re-submitting an already-recorded verdict is a
    // no-op, not a silent overwrite — a duplicate call must not clobber the
    // recorded evidence/reasoning behind an existing verdict. The read here is
    // only the fast path; the atomic guard in `updateByCheckItemIfPending` is
    // the actual race protection (a concurrent duplicate can pass this check
    // before either write lands).
    const current = (
      await new VerifyCheckResultModel(this.db, this.userId, this.workspaceId).listByRun(run.id)
    ).find((result) => result.checkItemId === params.checkItemId);
    if (current && TERMINAL_RESULT_STATUSES.has(current.status)) {
      // Report the persisted verdict, not the status: every non-passed verdict
      // maps to status "failed", so echoing the status would claim "failed"
      // was recorded even when the stored verdict is e.g. "uncertain".
      const reported = current.verdict ?? current.status;
      // A previous call may have persisted the verdict but thrown during
      // settlement (recompute/finalize), leaving the run terminal-but-unsettled
      // where the stuck-verification sweep cannot recover it. Duplicate calls
      // therefore re-run the idempotent settlement instead of blind-acking the
      // receipt — except while a repair round is in flight (status "repairing"),
      // which owns settlement from here on.
      const freshRun = await new VerifyRunModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).findByOperation(targetOperationId);
      if (freshRun && freshRun.status !== 'repairing') {
        const incomplete = await this.settleOrReportIncomplete(targetOperationId, reported);
        if (incomplete) return incomplete;
      }
      return {
        content: `Verdict "${reported}" was already recorded for this check; the duplicate submission was ignored.`,
        success: true,
      };
    }

    const status = params.verdict === 'passed' ? 'passed' : 'failed';
    // Atomic terminal guard: the conditional update only lands when the row is
    // still pending, so two concurrent submissions cannot both pass the
    // listByRun() check above and overwrite each other's verdict/evidence.
    const [updated] = await new VerifyCheckResultModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).updateByCheckItemIfPending(run.id, params.checkItemId, {
      completedAt: new Date(),
      status,
      toulmin: {
        counterEvidence: params.counterEvidence,
        evidence: params.evidence,
        limitation: params.limitation,
        reasoning: params.reasoning,
      },
      verdict: params.verdict,
    });
    if (!updated) {
      // Lost the race: a concurrent submission landed first and the row is now
      // terminal. Re-read and report the persisted verdict as an idempotent
      // receipt rather than overwriting it.
      const landed = (
        await new VerifyCheckResultModel(this.db, this.userId, this.workspaceId).listByRun(run.id)
      ).find((result) => result.checkItemId === params.checkItemId);
      const reported = landed?.verdict ?? landed?.status ?? params.verdict;
      // Race-lost duplicates go through the same settlement tail as the
      // terminal fast path above: the winner may have persisted its verdict
      // and then thrown during settlement, leaving the run terminal-but-
      // unsettled. The loser must not acknowledge success while the winner's
      // own receipt already surfaced the failure — both callers re-run the
      // idempotent settlement until it completes.
      const freshRun = await new VerifyRunModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).findByOperation(targetOperationId);
      if (freshRun && freshRun.status !== 'repairing') {
        const incomplete = await this.settleOrReportIncomplete(targetOperationId, reported);
        if (incomplete) return incomplete;
      }
      return {
        content: `Verdict "${reported}" was already recorded for this check; the duplicate submission was ignored.`,
        success: true,
      };
    }
    // This may be the last check to resolve — settle the run through the single
    // finalizer (repair-aware → drive the bound task on terminal). No report
    // context here (the verifier sub-agent lacks the builder's deliverable).
    await this.settle(targetOperationId);

    log(
      'submitted verdict %s for check %s (op %s)',
      params.verdict,
      params.checkItemId,
      targetOperationId,
    );

    return {
      content: `Recorded verdict "${params.verdict}" for the check. Verification complete.`,
      success: true,
    };
  };

  /**
   * Re-run the idempotent settlement tail for a run whose verdict already
   * landed, surfacing a loud `SETTLEMENT_INCOMPLETE` receipt when it fails.
   * Shared by both duplicate paths: the terminal fast path (a re-submission
   * after the verdict is recorded) and the race-lost path (this caller lost
   * the atomic pending-guard to a concurrent winner that may itself have
   * failed settlement).
   *
   * @returns an error receipt when settlement threw, or null when it completed.
   */
  private settleOrReportIncomplete = async (
    targetOperationId: string,
    reported: string,
  ): Promise<{ content: string; error: string; success: false } | null> => {
    try {
      await this.settle(targetOperationId);
    } catch (error) {
      log('settlement retry failed for op %s: %O', targetOperationId, error);
      return {
        content: `Verdict "${reported}" was already recorded for this check, but run settlement did not complete. Retry the submission to finish settlement.`,
        error: 'SETTLEMENT_INCOMPLETE',
        success: false,
      };
    }
    return null;
  };

  /**
   * Recompute the rollup and run the finalizer, unless a repair round holds
   * the run. The status read before this call can be stale: another finalizer
   * may have claimed the run `repairing` since. Recomputing over that claim
   * would put the run back to `failed` and let this finalizer claim and spawn
   * a second repair for the same failures, so the recompute leaves the claim
   * in place and the repair round settles the run.
   */
  private settle = async (targetOperationId: string): Promise<void> => {
    const status = await new VerifyStatusService(this.db, this.userId, this.workspaceId).recompute(
      targetOperationId,
      { preserveRepairClaim: true },
    );
    if (status === 'repairing') {
      log('op %s is held by a repair round; leaving settlement to it', targetOperationId);
      return;
    }
    await finalizeVerifyRun(this.db, this.userId, targetOperationId, {}, this.workspaceId);
  };
}

export const verifyResultRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for verify-result tool execution');
    }
    return new VerifyResultExecutionRuntime({
      operationId: context.operationId,
      serverDB: context.serverDB,
      userId: context.userId,
      workspaceId: context.workspaceId,
    });
  },
  identifier: VerifyToolIdentifier,
};
