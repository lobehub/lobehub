import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';

import { useVerifyReportUrl } from './useReportUrl';

export const useVerifyReportMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { reportUrl, runId } = useVerifyReportUrl();
  if (!runId) return;

  return {
    copyId: runId,
    copyLink: reportUrl,
    refresh: () => globalMutate(verifyKeys.reportBundle(runId)),
  };
};
