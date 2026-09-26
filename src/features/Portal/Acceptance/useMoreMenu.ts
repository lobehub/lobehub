import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';

import { useAcceptancePageUrl } from './usePageUrl';

export const useAcceptanceMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { acceptanceId, pageUrl } = useAcceptancePageUrl();
  if (!acceptanceId) return;

  return {
    copyId: acceptanceId,
    copyLink: pageUrl,
    refresh: () => globalMutate(verifyKeys.acceptanceBundle(acceptanceId)),
  };
};
