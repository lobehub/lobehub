import type { RemoteServerNetworkErrorType } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

const MIN_TOAST_INTERVAL = 10_000;
const lastShownAt = new Map<string, number>();

export const remoteServerErrorToast = (errorType: RemoteServerNetworkErrorType) => {
  const now = Date.now();
  const last = lastShownAt.get(errorType) ?? 0;
  if (now - last < MIN_TOAST_INTERVAL) return;
  lastShownAt.set(errorType, now);

  toast.error({ title: t(`response.${errorType}`, { ns: 'error' }) });
};
