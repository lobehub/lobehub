import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { verifyService } from '@/services/verify';

/** Plan + rollup status for one Agent Run. Pass null operationId to skip. */
export const useVerifyState = (operationId: string | null) =>
  useClientDataSWR(operationId ? verifyKeys.state(operationId) : null, () =>
    verifyService.getVerifyState(operationId!),
  );

/** Per-item check results for one Agent Run. Pass null operationId to skip. */
export const useVerifyResults = (operationId: string | null) =>
  useClientDataSWR(operationId ? verifyKeys.results(operationId) : null, () =>
    verifyService.listResults(operationId!),
  );

/** Full standalone report bundle (run + report + results + evidence) by verifyRunId. */
export const useVerifyReportBundle = (verifyRunId: string | null) =>
  useClientDataSWR(verifyRunId ? verifyKeys.reportBundle(verifyRunId) : null, () =>
    verifyService.getReportBundle(verifyRunId!),
  );

/** Current user's recent verification sessions with report rollup fields. */
export const useVerifyReportSummaries = () =>
  useClientDataSWR(verifyKeys.reportSummaries(), () => verifyService.listReportSummaries());

/** Model / token / latency for an LLM verifier judgment. Pass null to skip. */
export const useVerifierTracing = (tracingId: string | null | undefined) =>
  useClientDataSWR(tracingId ? verifyKeys.tracing(tracingId) : null, () =>
    verifyService.getVerifierTracing(tracingId!),
  );

/** The criterion's original judging rule, stored in its instruction document. */
export const useVerifyInstruction = (documentId: string | null | undefined) =>
  useClientDataSWR(documentId ? verifyKeys.instruction(documentId) : null, () =>
    documentService.getDocumentById(documentId!),
  );

/** A rubric and its run-policy config (e.g. maxRepairRounds). Pass null to skip. */
export const useRubric = (rubricId: string | null | undefined) =>
  useClientDataSWR(rubricId ? verifyKeys.rubric(rubricId) : null, () =>
    verifyService.getRubric(rubricId!),
  );

/** The workspace's reusable rubric templates (delivery-standard groups). */
export const useRubrics = () =>
  useClientDataSWR(verifyKeys.rubrics(), () => verifyService.listRubrics());

/** The workspace's reusable atomic criteria. */
export const useCriteria = () =>
  useClientDataSWR(verifyKeys.criteria(), () => verifyService.listCriteria());

/** The criteria a rubric groups, in rubric order. Pass null to skip. */
export const useRubricCriteria = (rubricId: string | null | undefined) =>
  useClientDataSWR(rubricId ? verifyKeys.rubricCriteria(rubricId) : null, () =>
    verifyService.getRubricCriteria(rubricId!),
  );
