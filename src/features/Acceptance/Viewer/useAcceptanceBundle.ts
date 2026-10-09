import type { AcceptanceBundle } from '@/services/verify';
import { useVerifyStore } from '@/store/verify';

import { LIVE_ACCEPTANCE_STATUSES } from './verdict';

/** Poll cadence of a still-moving acceptance round. */
const ACCEPTANCE_BUNDLE_POLL_INTERVAL = 5000;

/** What `useAcceptanceBundle` hands its readers — the former SWR response shape. */
export interface AcceptanceBundleSync {
  /** The bundle from the replica view; `undefined` until hydrated or fetched. */
  data: AcceptanceBundle | undefined;
  error: unknown;
  /** Nothing to show yet, and a hydration or fetch is still outstanding. */
  isLoading: boolean;
  isValidating: boolean;
  /** Re-read the bundle and resolve with the freshly read value. */
  mutate: () => Promise<AcceptanceBundle | undefined>;
}

/**
 * The acceptance bundle, read from the verify store's replica of
 * `acceptanceBundleMap[acceptanceId]` — the local projection paints on the
 * first frame, the network confirms behind it.
 *
 * The bundle is a LIVE decision surface (rounds run and reviews land while the
 * reviewer is away), so the sync revalidates on focus/reconnect and polls every
 * 5s while the aggregate is still moving.
 *
 * `poll: false` is for a surface that reads a bundle only as a DETAIL view —
 * the goal result page opens one per task row — where the live 5s poll would
 * run one interval per opened row. Such a surface keeps focus/reconnect
 * revalidation (returning to the tab still refreshes) and leaves the always-on
 * polling to the acceptance page itself.
 */
export const useAcceptanceBundle = (
  acceptanceId: string | null,
  options?: { poll?: boolean },
): AcceptanceBundleSync => {
  const poll = options?.poll ?? true;
  const useFetchAcceptanceBundle = useVerifyStore((s) => s.useFetchAcceptanceBundle);
  const data = useVerifyStore((s) =>
    acceptanceId ? s.acceptanceBundleMap[acceptanceId] : undefined,
  );

  const status = data?.acceptance.status;
  const polling = poll && !!status && LIVE_ACCEPTANCE_STATUSES.has(status);

  const sync = useFetchAcceptanceBundle(acceptanceId, {
    refreshInterval: polling ? ACCEPTANCE_BUNDLE_POLL_INTERVAL : 0,
  });

  return {
    data,
    error: sync.error,
    isLoading: !data && !sync.error && (sync.isValidating || !sync.isHydrated),
    isValidating: sync.isValidating,
    mutate: async () => {
      await sync.revalidate();
      return acceptanceId ? useVerifyStore.getState().acceptanceBundleMap[acceptanceId] : undefined;
    },
  };
};

type AcceptanceBundleData = AcceptanceBundle;

/** An evidence's current file URL, wherever in the bundle (a check or its history) it sits. */
export const findEvidenceFileUrl = (
  bundle: AcceptanceBundleData | undefined,
  evidenceId: string,
) => {
  for (const check of bundle?.checks ?? []) {
    const item =
      check.evidence.find((entry) => entry.id === evidenceId) ??
      check.timeline.flatMap((step) => step.evidence).find((entry) => entry.id === evidenceId);
    if (item) return item.fileUrl ?? undefined;
  }
  return undefined;
};

/**
 * Re-read the bundle to get a freshly signed URL for one evidence. Stored files
 * are served through signed links that expire; a page left open past that
 * cannot recover a failed video by retrying the same link.
 */
export const useEvidenceUrlRefresh = (acceptanceId: string | null | undefined) => {
  const { mutate } = useAcceptanceBundle(acceptanceId ?? null);
  if (!acceptanceId) return undefined;
  return async (evidenceId: string) => findEvidenceFileUrl(await mutate(), evidenceId);
};
