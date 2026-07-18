import type { UIChatMessage, WorkSummaryItem } from '@lobechat/types';

/**
 * Reads the operation-final work root id stamped on message/block metadata by
 * the server work registry (`metadata.work.rootOperationId`). Consumed by the
 * in-message Works chip resolution (`AssistantGroup`) and the work-summary index
 * below.
 */
export const getOperationFinalRootId = (
  metadata?: { work?: { rootOperationId?: unknown } } | null,
) =>
  typeof metadata?.work?.rootOperationId === 'string' ? metadata.work.rootOperationId : undefined;

const toTime = (value: unknown): number => {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value as string).getTime();
  return Number.isNaN(time) ? 0 : time;
};

/**
 * Build a `rootOperationId -> works` index from the raw db messages. The server
 * attaches each round's Work summaries to its anchor message (keyed by
 * `metadata.work.rootOperationId`), so a single flat pass over the raw rows
 * reconstructs the lookup the in-message chips need — no dedicated fetch.
 */
const buildWorkSummaryIndex = (messages: UIChatMessage[]): Map<string, WorkSummaryItem[]> => {
  const index = new Map<string, WorkSummaryItem[]>();
  for (const message of messages) {
    const works = message.works;
    if (!works || works.length === 0) continue;
    // Prefer the anchor message's own stamp; fall back to the work event's
    // rootOperationId so the lookup key always matches what the chip resolves.
    const rootOperationId =
      getOperationFinalRootId(message.metadata) ?? works[0].event.rootOperationId;
    if (rootOperationId) index.set(rootOperationId, works);
  }
  return index;
};

// Memoize per dbMessages array identity so the pass runs once per snapshot,
// regardless of how many MessageWorks instances read from it.
const indexCache = new WeakMap<UIChatMessage[], Map<string, WorkSummaryItem[]>>();

const getWorkSummaryIndex = (messages: UIChatMessage[]): Map<string, WorkSummaryItem[]> => {
  let index = indexCache.get(messages);
  if (!index) {
    index = buildWorkSummaryIndex(messages);
    indexCache.set(messages, index);
  }
  return index;
};

/** Works for one round's chip, resolved by the display-resolved rootOperationId. */
export const getWorkSummariesByRootOperationId = (
  messages: UIChatMessage[],
  rootOperationId?: string | null,
): WorkSummaryItem[] =>
  rootOperationId ? (getWorkSummaryIndex(messages).get(rootOperationId) ?? []) : [];

/**
 * Flatten a thread's Work summaries into the conversation-wide list the Works
 * sidebar (summary mode) renders: one row per Work, deduped to its latest event
 * and sorted newest-first. Mirrors the server `latestSummaryItemsByWork` shaping
 * the removed `listSummariesByConversation` used to return.
 */
const buildAllWorkSummaries = (
  messages: UIChatMessage[],
  threadId?: string | null,
): WorkSummaryItem[] => {
  const latestByWork = new Map<string, WorkSummaryItem>();
  for (const message of messages) {
    // Scope to the active thread here rather than at the call site: filtering
    // upstream would hand this function a fresh array on every call and defeat
    // the identity-keyed memo below.
    if (threadId ? message.threadId !== threadId : !!message.threadId) continue;
    for (const work of message.works ?? []) {
      const existing = latestByWork.get(work.id);
      if (!existing || toTime(work.event.createdAt) > toTime(existing.event.createdAt)) {
        latestByWork.set(work.id, work);
      }
    }
  }
  return Array.from(latestByWork.values()).sort(
    (a, b) => toTime(b.event.createdAt) - toTime(a.event.createdAt),
  );
};

// Memoize per (dbMessages array identity, threadId). Keying on the RAW messages
// reference — stable across unrelated chat-store `set()`s — means a full rebuild
// runs once per actual message snapshot, not on every streamed token / store
// tick. A pre-filtered array would produce a new identity each call and never
// hit this cache.
const MAIN_THREAD_CACHE_KEY = '__main__';
const allWorkSummariesCache = new WeakMap<UIChatMessage[], Map<string, WorkSummaryItem[]>>();

export const getAllWorkSummaries = (
  messages: UIChatMessage[],
  threadId?: string | null,
): WorkSummaryItem[] => {
  const cacheKey = threadId ?? MAIN_THREAD_CACHE_KEY;
  let byThread = allWorkSummariesCache.get(messages);
  if (!byThread) {
    byThread = new Map();
    allWorkSummariesCache.set(messages, byThread);
  }
  let list = byThread.get(cacheKey);
  if (!list) {
    list = buildAllWorkSummaries(messages, threadId);
    byThread.set(cacheKey, list);
  }
  return list;
};
