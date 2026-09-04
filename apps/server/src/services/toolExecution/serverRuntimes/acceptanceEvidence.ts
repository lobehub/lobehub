import type {
  AcceptanceCriterionSummary,
  SubmitAcceptanceEvidenceParams,
} from '@lobechat/builtin-tool-acceptance-evidence';
import { AcceptanceEvidenceIdentifier } from '@lobechat/builtin-tool-acceptance-evidence';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import type { ServerRuntimeRegistration } from './types';

/** Bounded wait for the run-start plan instantiation to land (~3s total). */
const PLAN_WAIT_ATTEMPTS = 6;
const PLAN_WAIT_INTERVAL_MS = 500;

class AcceptanceEvidenceExecutionRuntime {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly operationId?: string,
    private readonly workspaceId?: string,
  ) {}

  /**
   * The Agent Run whose verify plan this tool writes into.
   *
   * The builder now captures evidence inside the main Task run, so the plan
   * hangs off the operation the tool is called from. The post-run
   * evidence-submission turn is a *child* operation, and its plan still lives
   * on the parent — hence the parent wins when there is one. Resolving only the
   * parent (the original shape) made every in-run call fail NO_PARENT_OPERATION.
   */
  private resolveRunOperationId = async () => {
    if (!this.operationId) return undefined;
    const operation = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findById(this.operationId);
    if (!operation) return undefined;
    return operation.parentOperationId ?? operation.id;
  };

  listCriteria = async () => {
    if (!this.operationId) return { error: 'NO_OPERATION', success: false };

    const runOperationId = await this.resolveRunOperationId();
    if (!runOperationId) return { error: 'NO_OPERATION', success: false };

    // The plan is instantiated fire-and-forget at run start, so a builder that
    // asks what to prove as its first move can legitimately arrive before it
    // lands. Answering NO_ACCEPTANCE_PLAN then reads as "this Task has no
    // Acceptance" and the run finishes with no evidence at all, so wait out the
    // race instead of racing it.
    const runModel = new VerifyRunModel(this.db, this.userId, this.workspaceId);
    let run = await runModel.findByOperation(runOperationId);
    for (let attempt = 0; !run?.plan?.length && attempt < PLAN_WAIT_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, PLAN_WAIT_INTERVAL_MS));
      run = await runModel.findByOperation(runOperationId);
    }
    if (!run?.plan?.length) {
      return {
        content:
          'No Acceptance plan is attached to this run yet. If this Task is expected to have one, ' +
          'continue working and call listCriteria again before you finish.',
        error: 'NO_ACCEPTANCE_PLAN',
        success: false,
      };
    }

    const evidence = await new VerifyEvidenceModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).listByRun(run.id);
    const submittedByItem = new Map<string, number>();
    for (const row of evidence) {
      submittedByItem.set(row.checkItemId, (submittedByItem.get(row.checkItemId) ?? 0) + 1);
    }

    const criteria: AcceptanceCriterionSummary[] = run.plan.map((item) => {
      const declared = (item.verifierConfig as Record<string, unknown> | undefined)
        ?.requiredEvidence;
      return {
        id: item.id,
        index: item.index,
        required: item.required,
        ...(Array.isArray(declared)
          ? { requiredEvidence: declared as Array<{ hint?: string; type: string }> }
          : {}),
        submittedEvidence: submittedByItem.get(item.id) ?? 0,
        title: item.title,
      };
    });

    // `content` is what the model actually reads: the context engine replaces a
    // tool result with no readable content by a synthetic
    // `{"error":"Tool call failed"}`, so returning only structured fields made
    // this API look broken to the builder and pushed it off the plan-driven path.
    const content = criteria
      .map(
        (item) =>
          `- ${item.id} — ${item.title}${item.required ? ' (required)' : ''}` +
          `${item.requiredEvidence?.length ? `, requires ${item.requiredEvidence.map((e) => e.type).join('/')}` : ''}` +
          `${item.submittedEvidence > 0 ? `, ${item.submittedEvidence} evidence already submitted` : ''}`,
      )
      .join('\n');

    return {
      content: `Acceptance criteria for this run — pass an id as checkItemId to submitEvidence:\n${content}`,
      criteria,
      success: true,
    };
  };

  submitEvidence = async (rawParams: SubmitAcceptanceEvidenceParams) => {
    if (!this.operationId) return { error: 'NO_OPERATION', success: false };
    if (!rawParams.checkItemId || !rawParams.evidence?.length) {
      return { error: 'INVALID_ARGUMENTS', success: false };
    }

    // Models routinely pad the fields they are not using with `""` rather than
    // omitting them. An empty string is absent, not a reference: left as-is it
    // survives the `?? []` id collection below and fails the lookup, rejecting
    // an otherwise valid text submission as UNKNOWN_FILE.
    const params: SubmitAcceptanceEvidenceParams = {
      ...rawParams,
      evidence: rawParams.evidence.map((item) => ({
        ...item,
        content: item.content?.trim() ? item.content : undefined,
        documentId: item.documentId?.trim() ? item.documentId : undefined,
        fileId: item.fileId?.trim() ? item.fileId : undefined,
      })),
    };

    // `content` is a caption, not a competing payload. Requiring exactly one of
    // the three made a live builder that had captured a screenshot AND wanted to
    // describe it get rejected, drop the fileId, and resubmit prose with the id
    // written into the text — the exact text-only outcome this path exists to
    // prevent. Only the two *references* are mutually exclusive.
    const empty = params.evidence.find((item) => !item.content && !item.documentId && !item.fileId);
    if (empty) {
      return {
        content: 'Every evidence item needs content, a documentId, or a fileId.',
        error: 'INVALID_EVIDENCE',
        success: false,
      };
    }
    const ambiguous = params.evidence.find((item) => item.documentId && item.fileId);
    if (ambiguous) {
      return {
        content:
          'An evidence item references either a documentId or a fileId, not both. ' +
          'Use `content` for any prose you want to attach alongside it.',
        error: 'INVALID_EVIDENCE',
        success: false,
      };
    }

    // A visual type is a claim about an artifact a reviewer can open. Prose
    // saying a screenshot was taken is not that claim's evidence — a live run
    // submitted `{ type: 'screenshot', content: '…(see the screenshot file)' }`
    // with no file, which renders on the acceptance as a visual check with
    // nothing behind it: strictly worse than an honest text note.
    const unbacked = params.evidence.find(
      (item) => (item.type === 'screenshot' || item.type === 'video') && !item.fileId,
    );
    if (unbacked) {
      return {
        content:
          `Evidence of type "${unbacked.type}" must reference a real artifact through fileId — ` +
          'inline content cannot stand in for one. Capture the artifact with a tool that ' +
          'returns a files.id, then cite that id. If you cannot produce one, submit what you ' +
          'actually observed as type "text" instead of claiming a visual artifact.',
        error: 'UNBACKED_VISUAL_EVIDENCE',
        success: false,
      };
    }

    const runOperationId = await this.resolveRunOperationId();
    if (!runOperationId) return { error: 'NO_OPERATION', success: false };

    const run = await new VerifyRunModel(this.db, this.userId, this.workspaceId).findByOperation(
      runOperationId,
    );
    const item = run?.plan?.find((candidate) => candidate.id === params.checkItemId);
    if (!run || !item) return { error: 'UNKNOWN_CRITERION', success: false };

    const documentIds = [
      ...new Set(params.evidence.flatMap((evidence) => evidence.documentId ?? [])),
    ];
    if (documentIds.length > 0) {
      const documents = await new DocumentModel(this.db, this.userId, this.workspaceId).findByIds(
        documentIds,
      );
      const existingIds = new Set(documents.map((document) => document.id));
      const unknownId = documentIds.find((id) => !existingIds.has(id));
      if (unknownId) {
        return {
          content: `Document ${unknownId} does not exist or is not accessible. Use an id from documents.id, not agent_documents.id.`,
          error: 'UNKNOWN_DOCUMENT',
          success: false,
        };
      }
    }

    const fileIds = [...new Set(params.evidence.flatMap((evidence) => evidence.fileId ?? []))];
    if (fileIds.length > 0) {
      const files = await Promise.all(
        fileIds.map((fileId) =>
          new FileModel(this.db, this.userId, this.workspaceId).findById(fileId),
        ),
      );
      const unknownIndex = files.findIndex((file) => !file);
      if (unknownIndex >= 0) {
        return {
          content: `File ${fileIds[unknownIndex]} does not exist or is not accessible. Use an id from files.id.`,
          error: 'UNKNOWN_FILE',
          success: false,
        };
      }
    }

    const result = await new VerifyCheckResultModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).upsertByCheckItem({
      checkItemId: item.id,
      checkItemIndex: item.index,
      checkItemTitle: item.title,
      operationId: runOperationId,
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
        documentId: evidence.documentId ?? null,
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
