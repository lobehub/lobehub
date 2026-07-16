import type {
  AcceptanceCheckReviewAction,
  AcceptanceReviewAnnotation,
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

  listAcceptances = (): Promise<AcceptanceListItem[]> => lambdaClient.acceptance.list.query();

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
    id: string;
  }) => lambdaClient.acceptance.reviewChecks.mutate(input);

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

  /** Persist (user-edited) drafts as standalone criteria; returns ids in order. */
  createCriteria = (drafts: VerifyCriterionDraft[]): Promise<string[]> =>
    lambdaClient.verify.createCriteria.mutate({ drafts }) as Promise<string[]>;

  // ---- criteria / rubric management ----
  listCriteria = (): Promise<VerifyCriterionItem[]> =>
    lambdaClient.verify.listCriteria.query() as Promise<VerifyCriterionItem[]>;

  createCriterion = (input: CreateCriterionInput): Promise<VerifyCriterionItem> =>
    lambdaClient.verify.createCriterion.mutate(input) as Promise<VerifyCriterionItem>;

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
