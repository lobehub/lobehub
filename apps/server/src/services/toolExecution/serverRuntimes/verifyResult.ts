import type { SubmitVerifyResultParams } from '@lobechat/builtin-tool-verify';
import { VerifyToolIdentifier } from '@lobechat/builtin-tool-verify';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { LobeChatDatabase } from '@/database/type';
import { maybeAutoRepair, VerifyStatusService } from '@/server/services/verify';

import type { ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:verify-result-runtime');

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
    const targetOperationId = op?.parentOperationId ?? this.operationId;

    const status = params.verdict === 'passed' ? 'passed' : 'failed';
    await new VerifyCheckResultModel(this.db, this.userId, this.workspaceId).updateByCheckItem(
      targetOperationId,
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
    // This may be the last check to resolve — kick auto-repair if the run failed
    // with auto_repair checks (no-op until everything has a terminal result).
    await maybeAutoRepair(this.db, this.userId, targetOperationId, this.workspaceId);

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
