import type { AcceptanceCommentList } from '@lobechat/types';

import { useVerifyStore, verifySelectors } from '@/store/verify';

/**
 * Read access only. Hosts that display discussion need not mount its write
 * actions. Reads the verify store's replica of `acceptanceCommentMap`, so a
 * reload paints the last discussion before the network answers.
 */
export const useAcceptanceCommentList = (acceptanceId?: string) => {
  const useFetchAcceptanceComments = useVerifyStore((s) => s.useFetchAcceptanceComments);
  const sync = useFetchAcceptanceComments(acceptanceId);
  const entry: AcceptanceCommentList | undefined = useVerifyStore(
    verifySelectors.acceptanceComments(acceptanceId),
  );
  const confirmed = useVerifyStore(verifySelectors.isAcceptanceCommentsConfirmed(acceptanceId));

  // A restored empty discussion is only the last session's answer: until the
  // server confirms it, it reads as loading rather than "no comments yet".
  const data = entry && (entry.items.length > 0 || confirmed) ? entry : undefined;
  // A failed background refresh keeps the last discussion on screen.
  const error = data ? undefined : sync.error;

  return {
    data,
    error,
    isLoading: !!acceptanceId && !data && !error,
    mutate: sync.revalidate,
  };
};
