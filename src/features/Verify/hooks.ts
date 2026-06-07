import { useClientDataSWR } from '@/libs/swr';
import { documentService } from '@/services/document';
import { verifyService } from '@/services/verify';

export const VERIFY_STATE_KEY = 'verify-state';
export const VERIFY_RESULTS_KEY = 'verify-results';
export const VERIFY_TRACING_KEY = 'verify-tracing';
export const VERIFY_INSTRUCTION_KEY = 'verify-instruction';
export const VERIFY_RUBRIC_KEY = 'verify-rubric';

/** Plan + rollup status for one Agent Run. Pass null operationId to skip. */
export const useVerifyState = (operationId: string | null) =>
  useClientDataSWR(operationId ? [VERIFY_STATE_KEY, operationId] : null, () =>
    verifyService.getVerifyState(operationId!),
  );

/** Per-item check results for one Agent Run. Pass null operationId to skip. */
export const useVerifyResults = (operationId: string | null) =>
  useClientDataSWR(operationId ? [VERIFY_RESULTS_KEY, operationId] : null, () =>
    verifyService.listResults(operationId!),
  );

/** Model / token / latency for an LLM verifier judgment. Pass null to skip. */
export const useVerifierTracing = (tracingId: string | null | undefined) =>
  useClientDataSWR(tracingId ? [VERIFY_TRACING_KEY, tracingId] : null, () =>
    verifyService.getVerifierTracing(tracingId!),
  );

/** The criterion's original judging rule, stored in its instruction document. */
export const useVerifyInstruction = (documentId: string | null | undefined) =>
  useClientDataSWR(documentId ? [VERIFY_INSTRUCTION_KEY, documentId] : null, () =>
    documentService.getDocumentById(documentId!),
  );

/** A rubric and its run-policy config (e.g. maxRepairRounds). Pass null to skip. */
export const useRubric = (rubricId: string | null | undefined) =>
  useClientDataSWR(rubricId ? [VERIFY_RUBRIC_KEY, rubricId] : null, () =>
    verifyService.getRubric(rubricId!),
  );
