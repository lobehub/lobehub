import { AicoManagedPolicyError } from '@/server/services/aico/managedPolicy';
import { AsyncTaskError, AsyncTaskErrorType } from '@/types/asyncTask';

export const createVideoTaskSubmitError = (error: unknown, providerContentPolicyMessage?: string) => {
  if (error instanceof AicoManagedPolicyError) {
    return new AsyncTaskError(
      AsyncTaskErrorType.InvalidProviderAPIKey,
      error.code || error.message || 'Billing or authorization error',
    );
  }

  return new AsyncTaskError(
    providerContentPolicyMessage
      ? AsyncTaskErrorType.ProviderContentModeration
      : AsyncTaskErrorType.TaskTriggerError,
    providerContentPolicyMessage ??
      'Failed to submit video task: ' + (error instanceof Error ? error.message : 'Unknown error'),
  );
};
