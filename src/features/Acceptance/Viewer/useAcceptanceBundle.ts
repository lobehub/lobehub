import { useEffect } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { LIVE_ACCEPTANCE_STATUSES } from './verdict';

const ACCEPTANCE_BUNDLE_SWR_CONFIG = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
} as const;

export const useAcceptanceBundle = (acceptanceId: string | null) => {
  const swr = useClientDataSWR(
    acceptanceId ? verifyKeys.acceptanceBundle(acceptanceId) : null,
    () => verifyService.getAcceptanceBundle(acceptanceId!),
    ACCEPTANCE_BUNDLE_SWR_CONFIG,
  );

  const status = swr.data?.acceptance.status;
  useEffect(() => {
    if (!status || !LIVE_ACCEPTANCE_STATUSES.has(status)) return;
    const timer = setInterval(() => void swr.mutate(), 5000);
    return () => clearInterval(timer);
  }, [status, swr.mutate]);

  return swr;
};
