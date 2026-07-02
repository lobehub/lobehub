import type { VerifyUserDecision, VerifyVerdict } from '@lobechat/types';

import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Ground-truth derived from comparing the user's decision against the verifier's
 * verdict. Drives the data flywheel (nightly FP/FN aggregation by verifier_type).
 *
 * - false positive: verifier said `failed` but the user disagreed (rejected) or
 *   shipped anyway (overridden) — the verifier flagged a non-issue.
 * - false negative: verifier said `passed` but the user rejected it — the
 *   verifier missed a real problem.
 */
export const computeFalseFlags = (
  verdict: VerifyVerdict | null,
  decision: VerifyUserDecision,
): { isFalseNegative: boolean; isFalsePositive: boolean } => ({
  isFalseNegative: verdict === 'passed' && decision === 'rejected',
  isFalsePositive: verdict === 'failed' && (decision === 'rejected' || decision === 'overridden'),
});

export class VerifyFeedbackService {
  private readonly resultModel: VerifyCheckResultModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
  }

  /** Record a user's decision on a result and precompute its FP/FN flags. */
  async submitDecision(resultId: string, decision: VerifyUserDecision): Promise<boolean> {
    const result = await this.resultModel.findById(resultId);
    if (!result) return false;

    const { isFalsePositive, isFalseNegative } = computeFalseFlags(result.verdict, decision);

    await this.resultModel.update(resultId, {
      isFalseNegative,
      isFalsePositive,
      userDecision: decision,
    });
    return true;
  }
}
