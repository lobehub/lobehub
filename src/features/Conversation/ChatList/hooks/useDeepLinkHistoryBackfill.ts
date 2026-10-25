import { useEffect, useRef } from 'react';

/** Upper bound of older pages one deep link may pull in before giving up. */
export const MAX_DEEP_LINK_BACKFILL_PAGES = 50;

interface UseDeepLinkHistoryBackfillOptions {
  /** Changes with every navigation to a deep link, even to the same message. */
  deepLinkKey?: string;
  loadEarlierMessages: () => Promise<void>;
  /** Rows loaded so far; a page that adds none means the topic start was reached. */
  loadedCount: number;
  /** The first page has settled and the list pages backward. */
  ready: boolean;
  /** The target is among the loaded rows. */
  resolved: boolean;
}

/**
 * A deep link (a search hit, a `#<messageId>` URL) can point at a message older
 * than the loaded window. Page older history in, one page per settled load,
 * until the target is loaded, a page adds nothing, or the page budget is spent.
 */
export const useDeepLinkHistoryBackfill = ({
  deepLinkKey,
  loadedCount,
  loadEarlierMessages,
  ready,
  resolved,
}: UseDeepLinkHistoryBackfillOptions) => {
  const progressRef = useRef({ key: undefined as string | undefined, lastCount: -1, pages: 0 });

  useEffect(() => {
    if (!deepLinkKey || resolved || !ready) return;

    if (progressRef.current.key !== deepLinkKey)
      progressRef.current = { key: deepLinkKey, lastCount: -1, pages: 0 };
    const progress = progressRef.current;
    if (progress.lastCount === loadedCount || progress.pages >= MAX_DEEP_LINK_BACKFILL_PAGES)
      return;

    progress.lastCount = loadedCount;
    progress.pages += 1;
    void loadEarlierMessages();
  }, [deepLinkKey, loadedCount, loadEarlierMessages, ready, resolved]);
};
