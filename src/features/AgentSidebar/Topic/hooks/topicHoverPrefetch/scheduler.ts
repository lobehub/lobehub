export const HOVER_DWELL_MS = 120;
// Content scrolling under a still pointer fires hover events the user never made.
export const SCROLL_QUIET_MS = 200;
export const NEIGHBOR_FLUSH_MS = 500;
export const MAX_PREVIEW_BATCH = 4;

interface TopicHoverSchedulerOptions {
  canPrefetch: (topicId: string) => boolean;
  canPreview: (topicId: string) => boolean;
  fetchPreviews: (topicIds: string[]) => Promise<void>;
  getNeighbors: (topicId: string) => string[];
  prefetchFirstPage: (topicId: string) => Promise<void>;
}

export const createTopicHoverScheduler = ({
  canPrefetch,
  canPreview,
  fetchPreviews,
  getNeighbors,
  prefetchFirstPage,
}: TopicHoverSchedulerOptions) => {
  let lastScrollAt = Number.NEGATIVE_INFINITY;
  let dwell: { timer: ReturnType<typeof setTimeout>; topicId: string } | undefined;
  // One intent per pointer entry: moving inside the same row must not repeat it.
  let intentFiredFor: string | undefined;

  let firstPageInFlight: string | undefined;
  let firstPageQueued: string | undefined;

  const collected = new Set<string>();
  let latestNeighbors: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let previewInFlight = false;

  const isFirstPageTarget = (topicId: string) =>
    topicId === firstPageInFlight || topicId === firstPageQueued;

  const runFirstPage = (topicId: string) => {
    firstPageInFlight = topicId;
    void prefetchFirstPage(topicId)
      .catch(() => undefined)
      .finally(() => {
        firstPageInFlight = undefined;
        const next = firstPageQueued;
        firstPageQueued = undefined;
        if (next && canPrefetch(next)) runFirstPage(next);
      });
  };

  const requestFirstPage = (topicId: string) => {
    if (isFirstPageTarget(topicId) || !canPrefetch(topicId)) return;
    if (firstPageInFlight) firstPageQueued = topicId;
    else runFirstPage(topicId);
  };

  const flush = () => {
    flushTimer = undefined;
    if (previewInFlight) return;

    const candidates = [...collected].filter((id) => !isFirstPageTarget(id) && canPreview(id));
    collected.clear();
    const batch =
      candidates.length > MAX_PREVIEW_BATCH
        ? latestNeighbors.filter((id) => candidates.includes(id)).slice(0, MAX_PREVIEW_BATCH)
        : candidates;
    if (batch.length === 0) return;

    previewInFlight = true;
    void fetchPreviews(batch)
      .catch(() => undefined)
      .finally(() => {
        previewInFlight = false;
        if (collected.size > 0 && !flushTimer) flush();
      });
  };

  const collectNeighbors = (topicId: string) => {
    collected.delete(topicId);
    const neighbors = getNeighbors(topicId).filter(
      (id) => id !== topicId && !isFirstPageTarget(id) && canPreview(id),
    );
    latestNeighbors = neighbors;
    for (const id of neighbors) collected.add(id);
    if (collected.size > 0 && !flushTimer) flushTimer = setTimeout(flush, NEIGHBOR_FLUSH_MS);
  };

  const intent = (topicId: string) => {
    requestFirstPage(topicId);
    collectNeighbors(topicId);
  };

  const cancelDwell = () => {
    if (!dwell) return;
    clearTimeout(dwell.timer);
    dwell = undefined;
  };

  return {
    focus: intent,
    pointerLeave: (topicId: string) => {
      if (dwell?.topicId === topicId) cancelDwell();
      if (intentFiredFor === topicId) intentFiredFor = undefined;
    },
    pointerMove: (topicId: string) => {
      if (Date.now() - lastScrollAt < SCROLL_QUIET_MS) return;
      if (dwell?.topicId === topicId || intentFiredFor === topicId) return;
      cancelDwell();
      dwell = {
        timer: setTimeout(() => {
          dwell = undefined;
          intentFiredFor = topicId;
          intent(topicId);
        }, HOVER_DWELL_MS),
        topicId,
      };
    },
    scroll: () => {
      lastScrollAt = Date.now();
      cancelDwell();
    },
  };
};

export type TopicHoverScheduler = ReturnType<typeof createTopicHoverScheduler>;
