import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useAcceptanceOrigin } from '@/features/Acceptance/origin';
import { acceptanceCheckPath } from '@/features/Acceptance/Viewer/routes';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useVerifyStore } from '@/store/verify';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import { buildPortalShareUrl } from '../components/PortalMoreMenu/shareUrl';

export const useAcceptanceCheckMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const portal = useChatStore(chatPortalSelectors.acceptanceCheckPortal);
  const appOrigin = useAcceptanceOrigin();
  const workspaceSlug = useActiveWorkspaceSlug();
  const shareUrl = buildPortalShareUrl(
    appOrigin,
    portal ? acceptanceCheckPath(portal.acceptanceId, portal.checkId) : undefined,
    workspaceSlug,
  );

  if (!portal) return;
  const { acceptanceId, checkId } = portal;

  return {
    copyId: checkId,
    copyLink: shareUrl,
    openInPage: shareUrl ? () => openTrustedExternalUrl(shareUrl) : undefined,
    // A check has no cache of its own — it is read out of the acceptance bundle.
    refresh: () => useVerifyStore.getState().refreshAcceptanceBundle(acceptanceId),
  };
};
