import { useVerifyReportBundle } from '@/features/Acceptance/hooks';
import { buildAcceptanceRoundPath } from '@/features/Acceptance/roundLink';
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
  const runId = useChatStore(chatPortalSelectors.verifyReportRunId);
  // Same SWR key as the portal's title and body, so this shares their request.
  const { data } = useVerifyReportBundle(runId ?? null);
  const roundPath = buildAcceptanceRoundPath(data?.run);
  // Copied and opened outside the app, so it stays on the public route: the
  // workspace-prefixed one only mounts for members of that workspace.
  const reportUrl = roundPath ? `${appOrigin}${roundPath}` : undefined;
  // Without an origin the URL is relative — the system browser has nothing to resolve it against.
  const externalUrl = appOrigin && reportUrl ? reportUrl : undefined;

  return { externalUrl, reportUrl, runId, standalone: Boolean(data) && !roundPath };
};
