import { randomUUID } from 'node:crypto';

import type {
  AcceptanceCriterionSummary,
  AuthorAcceptanceCriteriaParams,
  SubmitAcceptanceEvidenceParams,
} from '@lobechat/builtin-tool-acceptance-evidence';
import { AcceptanceEvidenceIdentifier } from '@lobechat/builtin-tool-acceptance-evidence';
import type { VerifyCheckItem } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';
import { AcceptanceService } from '@/server/services/verify/acceptanceService';
import { resolveTaskAcceptance } from '@/server/services/verify/taskAcceptance';

import type { ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:acceptance-evidence-runtime');

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
   * on the parent. Repair operations have a parent AND their own round, so their
   * own plan must win; otherwise repaired evidence overwrites the failed round.
   */
  private resolveRunOperationId = async () => {
    if (!this.operationId) return undefined;
    const operation = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findById(this.operationId);
    if (!operation) return undefined;
    if (!operation.parentOperationId) return operation.id;
    const ownRun = await new VerifyRunModel(this.db, this.userId, this.workspaceId).findByOperation(
      operation.id,
    );
    return ownRun ? operation.id : operation.parentOperationId;
  };

  /**
   * The round this tool writes into, created on demand when the run-start
   * instantiation never landed one.
   *
   * The plan is minted fire-and-forget at run start and its failure is swallowed
   * (verify must never break a run), so a builder can legitimately find itself on
   * an operation with no session at all. That used to be a dead end — no criteria
   * to read and no way to record evidence — even though the Acceptance layer is
   * already built for a plan-less round: `buildAcceptanceCheckUnion` renders
   * results whose `checkItemId` is in no plan, and the submit path accepts an
   * arbitrary id while the plan is empty. So the in-Task path lazily creates the
   * session it needs, exactly like the builder-authored CLI round.
   */
  private ensureRun = async (runOperationId: string) =>
    new VerifyRunModel(this.db, this.userId, this.workspaceId).ensureForOperation(runOperationId);

  /**
   * Bind the round to the Task's Acceptance so authored checks reach the review
   * loop instead of living only on this operation.
   *
   * Called once the round is a real round (confirmed): an unconfirmed plan is not
   * a round yet, and binding it would leave a draft for the next attempt to fold
   * into. Best-effort — a refusal (e.g. a closed aggregate) must never break
   * evidence capture, which is the thing this tool exists for.
   */
  private bindToTaskAcceptance = async (runOperationId: string, runId: string) => {
    try {
      const operation = await new AgentOperationModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).findById(runOperationId);
      if (!operation?.taskId) return;
      const resolved = await resolveTaskAcceptance(
        this.db,
        this.userId,
        operation.taskId,
        this.workspaceId,
      );
      if (!resolved) return;
      await new AcceptanceService(this.db, this.userId, this.workspaceId).attachPolicyRun(
        runId,
        resolved.acceptance.id,
      );
    } catch (error) {
      log('bind run %s to its task acceptance failed (non-fatal): %O', runId, error);
    }
  };

  private summarize = (items: VerifyCheckItem[]): AcceptanceCriterionSummary[] =>
    items.map((item) => {
      const declared = (item.verifierConfig as Record<string, unknown> | undefined)
        ?.requiredEvidence;
      return {
        id: item.id,
        index: item.index,
        required: item.required,
        ...(Array.isArray(declared)
          ? { requiredEvidence: declared as Array<{ hint?: string; type: string }> }
          : {}),
        submittedEvidence: 0,
        title: item.title,
      };
    });

  /** `content` is what the model reads — always describe the next move in it. */
  private describeCriteria = (criteria: AcceptanceCriterionSummary[]) =>
    criteria
      .map(
        (item) =>
          `- ${item.id} — ${item.title}${item.required ? ' (required)' : ''}` +
          `${item.requiredEvidence?.length ? `, requires ${item.requiredEvidence.map((e) => e.type).join('/')}` : ''}` +
          `${item.submittedEvidence > 0 ? `, ${item.submittedEvidence} evidence already submitted` : ''}`,
      )
      .join('\n');

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
      // Two different situations read the same from here, and neither is a dead
      // end anymore: the plan may still be materialising, or it never will. The
      // answer has to name both, because the author path is what makes this
      // recoverable — a run with no checklist can still author one and evidence
      // it, instead of finishing with nothing.
      const failure = await this.describeInstantiationFailure(runOperationId);
      return {
        canAuthor: true,
        content:
          'No Acceptance criteria are attached to this run. Either the run-start plan is still ' +
          'materialising — keep working and call listCriteria again before you finish — or it ' +
          'never landed, in which case author the checklist yourself with authorCriteria (one ' +
          'item per standard this delivery must meet) and then evidence each item with ' +
          `submitEvidence.${failure}`,
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
    return {
      content: `Acceptance criteria for this run — pass an id as checkItemId to submitEvidence:\n${this.describeCriteria(criteria)}`,
      criteria,
      success: true,
    };
  };

  /**
   * Why the run-start instantiation produced no plan, when it recorded a reason.
   * Diagnostic only: it must never turn a readable answer into a failed call.
   */
  private describeInstantiationFailure = async (runOperationId: string) => {
    try {
      const operation = await new AgentOperationModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).findById(runOperationId);
      const error = operation?.metadata?.verifyPlanError;
      return typeof error === 'string' && error ? `\n\nThe automatic plan failed: ${error}` : '';
    } catch {
      return '';
    }
  };

  /**
   * Author the run's checklist when it has none.
   *
   * This is the in-Task arm of the standard Acceptance flow (`author the plan →
   * publish → review`), not a parallel mechanism: the items become the round's
   * frozen plan and the verifier judges them like any criterion. A run that
   * already has a plan keeps it — merging a second checklist into a minted one
   * would make the round's contract self-contradicting.
   */
  authorCriteria = async (rawParams: AuthorAcceptanceCriteriaParams) => {
    if (!this.operationId) return { error: 'NO_OPERATION', success: false };

    const items = (rawParams.items ?? [])
      .map((item) => ({ ...item, title: item.title?.trim() }))
      .filter((item) => Boolean(item.title));
    if (items.length === 0) {
      return {
        content: 'authorCriteria needs at least one item with a non-empty title.',
        error: 'INVALID_ARGUMENTS',
        success: false,
      };
    }

    const runOperationId = await this.resolveRunOperationId();
    if (!runOperationId) return { error: 'NO_OPERATION', success: false };

    const run = await this.ensureRun(runOperationId);
    if (run.plan?.length) {
      const criteria = this.summarize(run.plan);
      return {
        canAuthor: false,
        content:
          'This run already has its criteria — keep them and evidence those instead of authoring ' +
          `a new set:\n${this.describeCriteria(criteria)}`,
        criteria,
        error: 'PLAN_ALREADY_EXISTS',
        success: false,
      };
    }

    const plan: VerifyCheckItem[] = items.map((item, index) => ({
      description: item.description,
      id: randomUUID(),
      index,
      // Like the run-start holistic check: the fail decision belongs to the task
      // bridge (pass → completed / fail → brief), not to the auto-repair loop.
      onFail: 'manual',
      required: item.required ?? true,
      title: item.title,
      verifierConfig: {},
      verifierType: 'agent',
    }));

    const runModel = new VerifyRunModel(this.db, this.userId, this.workspaceId);
    try {
      // `setPlan` refuses a confirmed round, so a concurrent author loses this
      // race rather than overwriting the winner's checklist.
      await runModel.setPlan(run.id, plan);
      // The Task scenario has no "confirm the plan" step (the run-start path
      // auto-confirms for the same reason): confirm here so the completion gate
      // and the Acceptance review treat the authored checklist as a real round.
      await runModel.confirmPlan(run.id);
      await this.bindToTaskAcceptance(runOperationId, run.id);
    } catch (error) {
      log('authorCriteria could not write the plan for run %s: %O', run.id, error);
      const current = await runModel.findByOperation(runOperationId);
      return {
        canAuthor: false,
        content:
          'This run could not take an authored checklist — its plan is already frozen, or the ' +
          'write failed. Call listCriteria and evidence the criteria it reports.',
        ...(current?.plan?.length ? { criteria: this.summarize(current.plan) } : {}),
        error: 'PLAN_NOT_WRITABLE',
        success: false,
      };
    }

    const criteria = this.summarize(plan);
    log('authored %d acceptance criteria for run %s', plan.length, run.id);

    return {
      canAuthor: false,
      content:
        `Authored ${plan.length} Acceptance criteria for this run — pass an id as checkItemId to ` +
        `submitEvidence:\n${this.describeCriteria(criteria)}`,
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
    if (!run || !item) {
      // A content-less error surfaces to the model as a synthetic
      // `{"error":"Tool call failed"}`, which reads as a broken tool rather than
      // a wrong id — name the way out instead.
      return {
        canAuthor: !run?.plan?.length,
        content: run?.plan?.length
          ? `"${params.checkItemId}" is not a criterion of this run. Pass an id exactly as ` +
            `listCriteria returned it:\n${this.describeCriteria(this.summarize(run.plan))}`
          : 'This run has no criteria yet, so there is nothing to submit against. Author the ' +
            'checklist with authorCriteria first, then evidence the ids it returns.',
        error: 'UNKNOWN_CRITERION',
        success: false,
      };
    }

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
