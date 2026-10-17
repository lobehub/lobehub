import type { TrpcClient } from '../api/client';
import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';

/**
 * The acceptance page and, when the round is known, its fixed snapshot via
 * `?r=<roundIndex>` — the only user-facing links to a run's report.
 */
export const acceptanceUrls = (acceptanceId: string, roundIndex: number | null) => {
  const acceptanceUrl = new URL(
    `/acceptance/${encodeURIComponent(acceptanceId)}`,
    resolveServerUrl(),
  ).toString();
  const roundUrl =
    roundIndex === null ? null : `${acceptanceUrl}?r=${encodeURIComponent(String(roundIndex))}`;

  return { acceptanceUrl, roundUrl };
};

/**
 * A run's report only has a page through its acceptance round; a standalone
 * run (or a server that cannot resolve it) has no link.
 */
export const resolveRunReportUrl = async (
  client: TrpcClient,
  verifyRunId: string,
): Promise<string | null> => {
  const round = await client.verify.getRunAcceptanceRound
    .query({ verifyRunId })
    .catch((error: unknown) => {
      log.warn(`Could not resolve the report link: ${(error as Error).message}`);
      return null;
    });
  if (!round) return null;

  const { acceptanceUrl, roundUrl } = acceptanceUrls(round.acceptanceId, round.roundIndex);

  return roundUrl ?? acceptanceUrl;
};
