import { ChatErrorType } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { TRPCClientError } from '@trpc/client';
import { t } from 'i18next';

interface LobeHubModelDeprecatedErrorData {
  modelType?: string;
  requestedModel?: string;
}

export const handleLobeHubModelDeprecatedError = (error: unknown) => {
  if (!(error instanceof TRPCClientError) || error.message !== ChatErrorType.LobeHubModelDeprecated)
    return;

  const requestedModel = (error.data?.errorData as LobeHubModelDeprecatedErrorData | undefined)
    ?.requestedModel;

  toast.error(
    t('response.LobeHubModelDeprecated', {
      model: requestedModel ?? '-',
      ns: 'error',
    }),
  );
};
