import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

/** Web URL of the verify report the portal shows; `undefined` until a run id is known. */
export const useVerifyReportUrl = () => {
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const runId = useChatStore(chatPortalSelectors.verifyReportRunId);
  const reportPath = runId
    ? buildWorkspaceAwarePath(`/verify/${runId}`, activeWorkspaceSlug)
    : undefined;
  const reportUrl = reportPath ? `${appOrigin}${reportPath}` : undefined;
  // Without an origin the URL is relative — the system browser has nothing to resolve it against.
  const externalUrl = appOrigin && reportUrl ? reportUrl : undefined;

  return { externalUrl, reportUrl, runId };
};
