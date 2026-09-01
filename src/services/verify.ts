import type {
  AcceptanceChecklistItem,
  AcceptanceCheckReviewAction,
  AcceptanceRejectIntent,
  AcceptanceReviewAnnotation,
  AcceptanceSubjectType,
  ReviewAdjudication,
  ReviewProposalEdit,
  VerifierType,
  VerifyCheckItem,
  VerifyEvidence,
  VerifyOnFailStrategy,
  VerifyReport,
  VerifyRubricConfig,
  VerifyUserDecision,
} from '@lobechat/types';

import type { VerifyStatus } from '@/database/models/agentOperation';
import type {
  VerifyCheckResultItem,
  VerifyCriterionItem,
  VerifyRubricItem,
  VerifyRunItem,
} from '@/database/schemas/verify';
import { lambdaClient } from '@/libs/trpc/client';

export type AcceptanceBundle = Awaited<ReturnType<typeof lambdaClient.acceptance.getBundle.query>>;
export type AcceptanceBySubject = Awaited<
  ReturnType<typeof lambdaClient.acceptance.getBySubject.query>
>;
export type AcceptanceListItem = Awaited<
  ReturnType<typeof lambdaClient.acceptance.list.query>
>[number];

/** Editable fields of a single delivery-check criterion. */
export interface UpdateCriterionValue {
  description?: string | null;
  documentId?: string | null;
  onFail?: VerifyOnFailStrategy;
  required?: boolean;
  title?: string;
  verifierConfig?: Record<string, unknown>;
  verifierType?: VerifierType;
}

/** Fields for authoring a new delivery-check criterion. */
export interface CreateCriterionInput {
  documentId?: string;
  onFail?: VerifyOnFailStrategy;
  required?: boolean;
  title: string;
  verifierConfig?: Record<string, unknown>;
  verifierType: VerifierType;
}

/** Fields for authoring a new rubric (named criteria group). */
export interface CreateRubricInput {
  config?: VerifyRubricConfig;
  description?: string;
  title: string;
}

/**
 * A proposed (or user-edited) acceptance criterion before it is persisted. The
 * shape returned by `generateCriteria` and the shape `createCriteria` accepts.
 */
export interface VerifyCriterionDraft {
  description?: string;
  /** Reuse an existing instruction doc (preserves the rubric on re-save). */
  documentId?: string | null;
  instruction?: string;
  onFail?: VerifyOnFailStrategy;
  required?: boolean;
  title: string;
  verifierConfig?: Record<string, unknown>;
  verifierType?: VerifierType;
}

export interface VerifyStateResponse {
  verifyPlan: VerifyCheckItem[] | null;
  verifyPlanConfirmedAt: Date | null;
  verifyStatus: VerifyStatus | null;
}

/** One evidence artifact plus resolved display metadata, when file-backed. */
export type VerifyEvidenceWithUrl = VerifyEvidence & {
  fileName: string | null;
  fileUrl: string | null;
};

/** One check result plus the evidence artifacts attached to it. */
export type VerifyResultWithEvidence = VerifyCheckResultItem & {
  evidence: VerifyEvidenceWithUrl[];
};

/** Everything the standalone report viewer needs for one verification session. */
export interface VerifyReportBundle {
  /**
   * Whether the viewer authored this run. Report URLs are public, so
   * author-only affordances (the origin conversation) gate on this — the server
   * redacts `run.metadata.origin` for everyone else.
   */
  isOwner: boolean;
  report: VerifyReport | null;
  results: VerifyResultWithEvidence[];
  run: VerifyRunItem;
}

export interface VerifyReportSummary {
  report: Pick<
    VerifyReport,
    | 'createdAt'
    | 'failedChecks'
    | 'generatedAt'
    | 'id'
    | 'overallConfidence'
    | 'passedChecks'
    | 'reviewedByUser'
    | 'summary'
    | 'totalChecks'
    | 'uncertainChecks'
    | 'verdict'
    | 'verifyRunId'
  > | null;
  run: VerifyRunItem;
}

/** One cursor-paginated page of report summaries. */
export interface VerifyReportSummaryPage {
  items: VerifyReportSummary[];
  /** Opaque token for the next page, or `null` when this is the last page. */
  nextCursor: string | null;
}

export interface GenerateDraftPlanInput {
  context?: string;
  enableAiGeneration?: boolean;
  goal: string;
  maxAiCriteria?: number;
  modelConfig?: { model: string; provider: string };
  operationId: string;
  verifyCriteriaIds?: string[];
  verifyRubricId?: string | null;
}

/** Client wrapper around the `verify` lambda router. */
export class VerifyService {
  // ---- subject-level acceptance ----
  getAcceptanceBundle = (id: string): Promise<AcceptanceBundle> =>
    lambdaClient.acceptance.getBundle.query({ id });

  /** The acceptance aggregate for a subject (topic/task/document), or null. */
  getAcceptanceBySubject = (subjectType: AcceptanceSubjectType, subjectId: string) =>
    lambdaClient.acceptance.getBySubject.query({ subjectId, subjectType });

  /** Persist a subject's standing acceptance checklist (topic tray). */
  saveAcceptanceChecklist = (
    subjectType: AcceptanceSubjectType,
    subjectId: string,
    checklist: AcceptanceChecklistItem[],
  ) => lambdaClient.acceptance.saveChecklist.mutate({ checklist, subjectId, subjectType });

  /** Set/update a subject's acceptance goal (the one-sentence outcome). */
  saveAcceptanceGoal = (
    subjectType: AcceptanceSubjectType,
    subjectId: string,
    requirement: string,
  ) => lambdaClient.acceptance.saveGoal.mutate({ requirement, subjectId, subjectType });

  listAcceptances = (options?: {
    filter?: 'active' | 'all' | 'completed';
    /** Widen the recency window (server-capped) — the merge picker asks for more. */
    limit?: number;
    q?: string;
    quiet?: boolean;
  }): Promise<AcceptanceListItem[]> =>
    lambdaClient.acceptance.list.query(
      options ? { filter: options.filter, limit: options.limit, q: options.q } : undefined,
      options?.quiet ? { context: { showNotification: false } } : undefined,
    );

  /**
   * Acceptance status for a known set of subjects. `listAcceptances` is capped
   * at the newest rows across every subject type, so a list surface deriving
   * per-row state must ask about its own subjects instead.
   */
  listAcceptanceStatuses = (
    subjectType: AcceptanceSubjectType,
    subjectIds: string[],
  ): Promise<Array<{ status: string; subjectId: string }>> =>
    lambdaClient.acceptance.listStatusesBySubjects.query({ subjectIds, subjectType });

  acceptDelivery = (id: string, comment?: string) =>
    lambdaClient.acceptance.accept.mutate({ comment, id });

  rejectDelivery = (id: string, comment: string) =>
    lambdaClient.acceptance.reject.mutate({ comment, id });

  /**
   * The user's verdict on individual union checks — accept settles a check for
   * good; reject records feedback the next round reads. A group "accept all"
   * is the same call with many ids.
   */
  reviewChecks = (input: {
    action: AcceptanceCheckReviewAction;
    annotations?: AcceptanceReviewAnnotation[];
    checkItemIds: string[];
    comment?: string;
    fileIds?: string[];
    id: string;
    /** Set when this decision answered a model proposal. */
    proposal?: {
      adjudication: ReviewAdjudication;
      edit?: ReviewProposalEdit;
      predictionId: string;
    };
    /** Which of the three jobs a reject is doing. */
    rejectIntent?: AcceptanceRejectIntent;
  }) => lambdaClient.acceptance.reviewChecks.mutate(input);

  /**
   * Queue proposals for the checks still awaiting a verdict. Explicit rather
   * than folded into the bundle read, so opening a report never spends model
   * budget. Returns as soon as the batch is dispatched (`queued`), NOT when it
   * finishes — the caller polls the bundle for the cards to appear.
   */
  predictReviews = (id: string) => lambdaClient.acceptance.predictReviews.mutate({ id });

  /**
   * Answer a proposal without ruling on the check. The `confirmed` case does
   * NOT come here — it rides along with the reject in `reviewChecks`, where the
   * edit diff is known.
   */
  adjudicateProposal = (input: {
    adjudication: 'misidentified' | 'not-an-issue';
    id: string;
    predictionId: string;
  }) => lambdaClient.acceptance.adjudicateProposal.mutate(input);

  /**
   * Feedback addressed to a check group (business category) — for concerns
   * that belong to no single check yet must reach the next round.
   */
  addGroupFeedback = (input: {
    category: string;
    comment: string;
    fileIds?: string[];
    id: string;
  }) => lambdaClient.acceptance.addGroupFeedback.mutate(input);

  /**
   * Dispatch the repair prompt straight into the acceptance's origin
   * conversation — a user message that triggers the agent, the same callback
   * channel remote hetero runs (`lh notify`) use.
   */
  dispatchAcceptanceRepair = (input: { agentId?: string; content: string; topicId: string }) =>
    lambdaClient.agentNotify.notify.mutate({
      agentId: input.agentId,
      content: input.content,
      role: 'user',
      topicId: input.topicId,
    });

  /** Stamp the aggregate `repairing` after the send-back dispatch. */
  markAcceptanceRepairing = (id: string) => lambdaClient.acceptance.markRepairing.mutate({ id });

  /** Rename the acceptance's sidebar entry (a metadata title override). */
  renameAcceptance = (id: string, title: string) =>
    lambdaClient.acceptance.rename.mutate({ id, title });

  /**
   * File the acceptance under a project (`null` takes it out of one). Only the
   * grouping moves — the delivery and its rounds stay exactly where they are.
   */
  setAcceptanceProject = (id: string, projectId: string | null) =>
    lambdaClient.acceptance.setProject.mutate({ id, projectId });

  /** Owner override of the acceptance's decision state from the list. */
  updateAcceptanceStatus = (id: string, status: 'accepted' | 'closed' | 'delivered' | 'rejected') =>
    lambdaClient.acceptance.updateStatus.mutate({ id, status });

  /**
   * Fold one acceptance into another — the source's checks (and the rounds /
   * evidence behind them) move onto the target, and the source entry is
   * removed. Returns what the merge actually moved.
   */
  mergeAcceptance = (sourceId: string, targetId: string) =>
    lambdaClient.acceptance.merge.mutate({ sourceId, targetId });

  /** Delete the acceptance aggregate (its round reports detach, not delete). */
  deleteAcceptance = (id: string) => lambdaClient.acceptance.remove.mutate({ id });

  // ---- per-run plan ----
  getVerifyState = (operationId: string): Promise<VerifyStateResponse | null> =>
    lambdaClient.verify.getVerifyState.query({
      operationId,
    }) as Promise<VerifyStateResponse | null>;

  /** Resolve an agent verifier's sub-run to the thread it executed in. */
  getVerifierThread = (
    operationId: string,
  ): Promise<{ threadId: string | null; topicId: string | null } | null> =>
    lambdaClient.verify.getVerifierThread.query({ operationId });

  /** Model / token / latency of an LLM verifier's judgment (by tracing id). */
  getVerifierTracing = (
    tracingId: string,
  ): Promise<{
    inputTokens: number | null;
    latencyMs: number | null;
    model: string | null;
    outputTokens: number | null;
    provider: string | null;
  } | null> => lambdaClient.verify.getVerifierTracing.query({ tracingId });

  generateDraftPlan = (input: GenerateDraftPlanInput): Promise<VerifyCheckItem[]> =>
    lambdaClient.verify.generateDraftPlan.mutate(input) as Promise<VerifyCheckItem[]>;

  updateDraftItems = (operationId: string, items: VerifyCheckItem[]): Promise<unknown> =>
    lambdaClient.verify.updateDraftItems.mutate({ items, operationId });

  confirmPlan = (operationId: string): Promise<unknown> =>
    lambdaClient.verify.confirmPlan.mutate({ operationId });

  skipPlan = (operationId: string): Promise<unknown> =>
    lambdaClient.verify.skipPlan.mutate({ operationId });

  // ---- results / execution ----
  listResults = (operationId: string): Promise<VerifyCheckResultItem[]> =>
    lambdaClient.verify.listResults.query({ operationId }) as Promise<VerifyCheckResultItem[]>;

  /** Full report payload for the standalone viewer, addressed by verifyRunId. */
  getReportBundle = (verifyRunId: string): Promise<VerifyReportBundle | null> =>
    lambdaClient.verify.getReportBundle.query({
      verifyRunId,
    }) as Promise<VerifyReportBundle | null>;

  /**
   * One cursor-paginated page of the current user's verification sessions with
   * report rollup fields. `cursor` comes from the previous page's `nextCursor`;
   * `q` filters by title on the server so search spans the whole history.
   */
  listReportSummaries = (params?: {
    cursor?: string;
    limit?: number;
    q?: string;
  }): Promise<VerifyReportSummaryPage> =>
    lambdaClient.verify.listReportSummaries.query(params) as Promise<VerifyReportSummaryPage>;

  deleteRun = (verifyRunId: string): Promise<unknown> =>
    lambdaClient.verify.deleteRun.mutate({ verifyRunId });

  updateRunTitle = (verifyRunId: string, title: string): Promise<unknown> =>
    lambdaClient.verify.updateRun.mutate({ value: { title }, verifyRunId });

  executeVerify = (input: {
    batchLlm?: boolean;
    deliverable: string;
    goal: string;
    modelConfig: { model: string; provider: string };
    operationId: string;
  }): Promise<VerifyCheckResultItem[]> =>
    lambdaClient.verify.executeVerify.mutate(input) as Promise<VerifyCheckResultItem[]>;

  submitDecision = (resultId: string, decision: VerifyUserDecision): Promise<unknown> =>
    lambdaClient.verify.submitDecision.mutate({ decision, resultId });

  // ---- config-time AI generation (one-sentence → criteria) ----
  /** Turn a one-sentence requirement into proposed criteria (traced; not persisted). */
  generateCriteria = (input: {
    context?: string;
    goal: string;
    maxCriteria?: number;
    modelConfig: { model: string; provider: string };
  }): Promise<VerifyCriterionDraft[]> =>
    lambdaClient.verify.generateCriteria.mutate(input) as Promise<VerifyCriterionDraft[]>;

  /** Draft the standing acceptance criteria used by the create-goal review step. */
  generateGoalCriteria = (input: {
    context?: string;
    goal: string;
    maxCriteria?: number;
  }): Promise<VerifyCriterionDraft[]> =>
    lambdaClient.verify.generateGoalCriteria.mutate(input) as Promise<VerifyCriterionDraft[]>;

  /** Draft the title, instruction, and criteria used by the create-goal review step. */
  generateGoalPlan = (input: {
    context?: string;
    goal: string;
    maxCriteria?: number;
  }): Promise<
    { criteria: VerifyCriterionDraft[]; instruction: string; title: string } | undefined
  > =>
    lambdaClient.verify.generateGoalPlan.mutate(input) as Promise<
      { criteria: VerifyCriterionDraft[]; instruction: string; title: string } | undefined
    >;

  /** Persist (user-edited) drafts as standalone criteria; returns ids in order. */
  createCriteria = (drafts: VerifyCriterionDraft[]): Promise<string[]> =>
    lambdaClient.verify.createCriteria.mutate({ drafts }) as Promise<string[]>;

  // ---- criteria / rubric management ----
  listCriteria = (): Promise<VerifyCriterionItem[]> =>
    lambdaClient.verify.listCriteria.query() as Promise<VerifyCriterionItem[]>;

  createCriterion = (input: CreateCriterionInput): Promise<VerifyCriterionItem> =>
    lambdaClient.verify.createCriterion.mutate(input) as Promise<VerifyCriterionItem>;

  /** Copy legacy rubric-backed criteria before a task edits them. */
  forkRubricCriteria = (ids: string[]): Promise<string[]> =>
    lambdaClient.verify.forkRubricCriteria.mutate({ ids }) as Promise<string[]>;

  updateCriterion = (id: string, value: UpdateCriterionValue): Promise<unknown> =>
    lambdaClient.verify.updateCriterion.mutate({ id, value });

  deleteCriterion = (id: string): Promise<unknown> =>
    lambdaClient.verify.deleteCriterion.mutate({ id });

  listRubrics = (): Promise<VerifyRubricItem[]> =>
    lambdaClient.verify.listRubrics.query() as Promise<VerifyRubricItem[]>;

  createRubric = (input: CreateRubricInput): Promise<VerifyRubricItem> =>
    lambdaClient.verify.createRubric.mutate(input) as Promise<VerifyRubricItem>;

  /** Get the criteria mounted on a rubric (in rubric order). */
  getRubricCriteria = (rubricId: string): Promise<VerifyCriterionItem[]> =>
    lambdaClient.verify.getRubricCriteria.query({ rubricId }) as Promise<VerifyCriterionItem[]>;

  /** Replace the set of criteria a rubric groups (with optional ordering). */
  setRubricCriteria = (
    rubricId: string,
    criteria: { criterionId: string; sortOrder?: number }[],
  ): Promise<unknown> => lambdaClient.verify.setRubricCriteria.mutate({ criteria, rubricId });

  getRubric = (id: string): Promise<VerifyRubricItem | undefined> =>
    lambdaClient.verify.getRubric.query({ id }) as Promise<VerifyRubricItem | undefined>;

  /** Update a rubric's run-policy config (e.g. maxRepairRounds). */
  updateRubricConfig = (id: string, config: VerifyRubricConfig): Promise<unknown> =>
    lambdaClient.verify.updateRubric.mutate({ id, value: { config } });

  /** Rename a rubric (the delivery-standard title). */
  updateRubricTitle = (id: string, title: string): Promise<unknown> =>
    lambdaClient.verify.updateRubric.mutate({ id, value: { title } });
}

export const verifyService = new VerifyService();
