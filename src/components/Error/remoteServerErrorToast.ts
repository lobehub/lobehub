import type { RemoteServerNetworkErrorType } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

export const remoteServerErrorToast = (errorType: RemoteServerNetworkErrorType) => {
  toast.error({
    id: `remote-server-network-error-${errorType}`,
    title: t(`response.${errorType}`, { ns: 'error' }),
  });
};
