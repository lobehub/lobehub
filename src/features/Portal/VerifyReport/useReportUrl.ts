import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useVerifyReportBundle } from '@/features/Acceptance/hooks';
import { buildAcceptanceRoundPath } from '@/features/Acceptance/roundLink';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

/**
 * Web URL of the acceptance round the portal's report belongs to — the report's
 * only page outside the app. `undefined` until the run is loaded, and for good
 * once it turns out to be `standalone` (no acceptance, so nothing to open).
 */
export const useVerifyReportUrl = () => {
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const runId = useChatStore(chatPortalSelectors.verifyReportRunId);
  // Same SWR key as the portal's title and body, so this shares their request.
  const { data } = useVerifyReportBundle(runId ?? null);
  const roundPath = buildAcceptanceRoundPath(data?.run);
  const reportPath = roundPath
    ? buildWorkspaceAwarePath(roundPath, activeWorkspaceSlug)
    : undefined;
  const reportUrl = reportPath ? `${appOrigin}${reportPath}` : undefined;
  // Without an origin the URL is relative — the system browser has nothing to resolve it against.
  const externalUrl = appOrigin && reportUrl ? reportUrl : undefined;

  return { externalUrl, reportUrl, runId, standalone: Boolean(data) && !roundPath };
};
