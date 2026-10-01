import { useEffect } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { LIVE_ACCEPTANCE_STATUSES } from './verdict';

const ACCEPTANCE_BUNDLE_SWR_CONFIG = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
} as const;

export const useAcceptanceBundle = (acceptanceId: string | null) => {
  const swr = useClientDataSWR(
    acceptanceId ? verifyKeys.acceptanceBundle(acceptanceId) : null,
    () => verifyService.getAcceptanceBundle(acceptanceId!),
    ACCEPTANCE_BUNDLE_SWR_CONFIG,
  );

  const status = swr.data?.acceptance.status;
  useEffect(() => {
    if (!status || !LIVE_ACCEPTANCE_STATUSES.has(status)) return;
    const timer = setInterval(() => void swr.mutate(), 5000);
    return () => clearInterval(timer);
  }, [status, swr.mutate]);

  return swr;
};

type AcceptanceBundleData = Awaited<ReturnType<typeof verifyService.getAcceptanceBundle>>;

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
