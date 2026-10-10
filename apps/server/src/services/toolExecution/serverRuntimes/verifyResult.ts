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

    // The result row is keyed by the parent run's verification session.
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
    // recorded evidence/reasoning behind an existing verdict.
    const current = (
      await new VerifyCheckResultModel(this.db, this.userId, this.workspaceId).listByRun(run.id)
    ).find((result) => result.checkItemId === params.checkItemId);
    if (current && TERMINAL_RESULT_STATUSES.has(current.status)) {
      return {
        content: `Verdict "${current.status}" was already recorded for this check; the duplicate submission was ignored.`,
        success: true,
      };
    }

    const status = params.verdict === 'passed' ? 'passed' : 'failed';
    await new VerifyCheckResultModel(this.db, this.userId, this.workspaceId).updateByCheckItem(
      run.id,
      params.checkItemId,
      {
        completedAt: new Date(),
        status,
        toulmin: {
          counterEvidence: params.counterEvidence,
          evidence: params.evidence,
          limitation: params.limitation,
          reasoning: params.reasoning,
        },
        verdict: params.verdict,
      },
    );
    await new VerifyStatusService(this.db, this.userId, this.workspaceId).recompute(
      targetOperationId,
    );
    // This may be the last check to resolve — settle the run through the single
    // finalizer (repair-aware → drive the bound task on terminal). No report
    // context here (the verifier sub-agent lacks the builder's deliverable).
    await finalizeVerifyRun(this.db, this.userId, targetOperationId, {}, this.workspaceId);

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
