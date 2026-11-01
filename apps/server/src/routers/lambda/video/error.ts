import { AsyncTaskError, AsyncTaskErrorType } from '@/types/asyncTask';

export const createVideoTaskSubmitError = (error: unknown, providerContentPolicyMessage?: string) =>
  new AsyncTaskError(
    providerContentPolicyMessage
      ? AsyncTaskErrorType.ProviderContentModeration
      : AsyncTaskErrorType.TaskTriggerError,
    providerContentPolicyMessage ??
      'Failed to submit video task: ' + (error instanceof Error ? error.message : 'Unknown error'),
  );
