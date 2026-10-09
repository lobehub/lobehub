import type { GoalAcceptanceFailureClause } from '@lobechat/types';

import { AcceptanceModel } from '@/database/models/acceptance';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

/** Freeze the actual independent verdict, never infer clauses from a Task error string. */
export class GoalAcceptanceFailureService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  capture = async (
    taskId: string,
    operationId?: string,
  ): Promise<GoalAcceptanceFailureClause[]> => {
    if (!operationId) return [];
    const acceptance = await new AcceptanceModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findBySubject('task', taskId);
    if (!acceptance) return [];
    const runs = await new VerifyRunModel(this.db, this.userId, this.workspaceId).listByAcceptance(
      acceptance.id,
    );
    const run = runs.findLast((item) => item.operationId === operationId);
    if (!run) return [];
    const [results, evidence] = await Promise.all([
      new VerifyCheckResultModel(this.db, this.userId, this.workspaceId).listByRun(run.id),
      new VerifyEvidenceModel(this.db, this.userId, this.workspaceId).listByRun(run.id),
    ]);
    return results
      .filter(
        (result) =>
          result.status === 'failed' ||
          result.verdict === 'failed' ||
          result.verdict === 'uncertain',
      )
      .map((result) => {
        const criterion = run.plan?.find((item) => item.id === result.checkItemId);
        return {
          checkItemId: result.checkItemId,
          criterionId: result.sourceCriterionId ?? criterion?.sourceCriterionId ?? undefined,
          evidence: evidence
            .filter((item) => item.checkResultId === result.id)
            .map((item) => ({
              content: item.content ?? undefined,
              description: item.description ?? undefined,
              documentId: item.documentId ?? undefined,
              fileId: item.fileId ?? undefined,
              id: item.id,
              type: item.type,
            })),
          narrative: result.toulmin ?? undefined,
          reason: result.toulmin?.reasoning ?? result.toulmin?.limitation ?? undefined,
          required: result.required,
          status: result.status,
          suggestion: result.suggestion ?? undefined,
          title: result.checkItemTitle ?? criterion?.title ?? result.checkItemId,
          verdict: result.verdict ?? undefined,
          verifierOperationId: result.verifierOperationId ?? undefined,
          verifyRunId: run.id,
        };
      });
  };
}
