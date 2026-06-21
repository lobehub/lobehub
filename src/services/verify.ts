import type {
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

export interface VerifyStateResponse {
  verifyPlan: VerifyCheckItem[] | null;
  verifyPlanConfirmedAt: Date | null;
  verifyStatus: VerifyStatus | null;
}

/** One evidence artifact plus its resolved (signed) file URL, when file-backed. */
export type VerifyEvidenceWithUrl = VerifyEvidence & { fileUrl: string | null };

/** One check result plus the evidence artifacts attached to it. */
export type VerifyResultWithEvidence = VerifyCheckResultItem & {
  evidence: VerifyEvidenceWithUrl[];
};

/** Everything the standalone report viewer needs for one verification session. */
export interface VerifyReportBundle {
  report: VerifyReport | null;
  results: VerifyResultWithEvidence[];
  run: VerifyRunItem;
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

  // ---- criteria / rubric management ----
  listCriteria = (): Promise<VerifyCriterionItem[]> =>
    lambdaClient.verify.listCriteria.query() as Promise<VerifyCriterionItem[]>;

  updateCriterion = (id: string, value: UpdateCriterionValue): Promise<unknown> =>
    lambdaClient.verify.updateCriterion.mutate({ id, value });

  listRubrics = (): Promise<VerifyRubricItem[]> =>
    lambdaClient.verify.listRubrics.query() as Promise<VerifyRubricItem[]>;

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
