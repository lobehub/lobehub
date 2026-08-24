import type { SubmitAcceptanceEvidenceParams } from '@lobechat/builtin-tool-acceptance-evidence';
import { AcceptanceEvidenceIdentifier } from '@lobechat/builtin-tool-acceptance-evidence';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import type { ServerRuntimeRegistration } from './types';

class AcceptanceEvidenceExecutionRuntime {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly operationId?: string,
    private readonly workspaceId?: string,
  ) {}

  submitEvidence = async (params: SubmitAcceptanceEvidenceParams) => {
    if (!this.operationId) return { error: 'NO_OPERATION', success: false };
    if (!params.checkItemId || !params.evidence?.length) {
      return { error: 'INVALID_ARGUMENTS', success: false };
    }
    if (params.evidence.some((item) => Boolean(item.content) === Boolean(item.fileId))) {
      return {
        content: 'Every evidence item must provide exactly one of content or fileId.',
        error: 'INVALID_EVIDENCE',
        success: false,
      };
    }

    const operation = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findById(this.operationId);
    if (!operation?.parentOperationId) return { error: 'NO_PARENT_OPERATION', success: false };

    const run = await new VerifyRunModel(this.db, this.userId, this.workspaceId).findByOperation(
      operation.parentOperationId,
    );
    const item = run?.plan?.find((candidate) => candidate.id === params.checkItemId);
    if (!run || !item) return { error: 'UNKNOWN_CRITERION', success: false };

    const result = await new VerifyCheckResultModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).upsertByCheckItem({
      checkItemId: item.id,
      checkItemIndex: item.index,
      checkItemTitle: item.title,
      operationId: operation.parentOperationId,
      required: item.required,
      verifierType: item.verifierType,
      verifyRunId: run.id,
    });

    await new VerifyEvidenceModel(this.db, this.userId, this.workspaceId).createMany(
      params.evidence.map((evidence) => ({
        capturedAt: new Date(),
        capturedBy: 'agent',
        checkResultId: result.id,
        content: evidence.content ?? null,
        description: evidence.description ?? null,
        fileId: evidence.fileId ?? null,
        type: evidence.type,
      })),
    );

    return {
      content: `Recorded ${params.evidence.length} evidence item(s) for "${item.title}".`,
      success: true,
    };
  };
}

export const acceptanceEvidenceRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) throw new Error('userId and serverDB are required');
    return new AcceptanceEvidenceExecutionRuntime(
      context.serverDB,
      context.userId,
      context.operationId,
      context.workspaceId,
    );
  },
  identifier: AcceptanceEvidenceIdentifier,
};
