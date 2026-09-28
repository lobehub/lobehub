import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

/** Web URL of the acceptance the portal shows; `undefined` until an id is known. */
export const useAcceptancePageUrl = () => {
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);
  const pagePath = acceptanceId
    ? buildWorkspaceAwarePath(`/acceptance/${acceptanceId}`, activeWorkspaceSlug)
    : undefined;
  const pageUrl = pagePath ? `${appOrigin}${pagePath}` : undefined;
  // Without an origin the URL is relative — the system browser has nothing to resolve it against.
  const externalUrl = appOrigin && pageUrl ? pageUrl : undefined;

  return { acceptanceId, externalUrl, pageUrl };
};
