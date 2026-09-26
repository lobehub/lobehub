import { acceptanceCheckPath } from '@/features/Acceptance/Viewer/routes';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import { usePortalShareUrl } from '../components/PortalMoreMenu/shareUrl';

export const useAcceptanceCheckMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const portal = useChatStore(chatPortalSelectors.acceptanceCheckPortal);
  const shareUrl = usePortalShareUrl(
    portal ? acceptanceCheckPath(portal.acceptanceId, portal.checkId) : undefined,
  );

  if (!portal) return;
  const { acceptanceId, checkId } = portal;

  return {
    copyId: checkId,
    copyLink: shareUrl,
    openInPage: shareUrl ? () => openTrustedExternalUrl(shareUrl) : undefined,
    // A check has no cache of its own — it is read out of the acceptance bundle.
    refresh: () => globalMutate(verifyKeys.acceptanceBundle(acceptanceId)),
  };
};
