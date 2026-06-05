import { useClientDataSWR } from '@/libs/swr';
import { verifyService } from '@/services/verify';

export const VERIFY_STATE_KEY = 'verify-state';
export const VERIFY_RESULTS_KEY = 'verify-results';

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
