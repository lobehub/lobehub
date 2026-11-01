import type { LoaderFunctionArgs } from 'react-router';
import { data, redirect } from 'react-router';

import { buildAcceptanceRoundPath } from '@/features/Acceptance/roundLink';
import { extractUuid } from '@/features/Acceptance/utils';

import { VerifyReportUnavailable } from '../../src/features/verify/VerifyReportUnavailable';
import { cloudflareContext } from '../lib/cloudflareContext';
import { createServerLambdaClient } from '../lib/serverTrpc';

// The standalone report page is gone: an old `/verify/:runId` link resolves to
// the run's acceptance round under the run's own read rule (the visitor's
// cookies ride along), and only a run with nowhere to go renders here.
export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const verifyRunId = extractUuid(params.runId);
  const apiBase = context.get(cloudflareContext).env.WORKBENCH_API_BASE as string | undefined;
  const round = verifyRunId
    ? await createServerLambdaClient(request, apiBase).verify.getRunAcceptanceRound.query({
        verifyRunId,
      })
    : null;
  const target = buildAcceptanceRoundPath(round, new URL(request.url).search);

  if (target) throw redirect(target);

  return data(null, { status: 404 });
};

export default function VerifyRunRedirectRoute() {
  return <VerifyReportUnavailable />;
}
