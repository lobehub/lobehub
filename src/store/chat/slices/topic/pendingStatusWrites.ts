import type { ChatTopic, ChatTopicStatus } from '@/types/topic';

export type PendingTopicStatusSource = 'cache' | 'server';

const PENDING_STATUS_TTL_MS = 15_000;

/**
 * Optimistic `updateTopicStatus` writes that a topic-list refetch must not
 * clobber. A refetch whose server query ran BEFORE a status write can land
 * AFTER the optimistic dispatch and revert the row — e.g. a run-end 'unread'
 * reverting to 'running', leaving the sidebar spinning forever on a finished
 * topic. Fetched rows are reconciled against these writes: a row still carrying
 * the pre-write status gets the pending status re-applied; a row already
 * reflecting it confirms propagation and drops the pin. TTL-bounded so a
 * failed persist or a legit cross-device status change can't be suppressed
 * indefinitely.
 */
export class PendingTopicStatusWrites {
  #writes = new Map<string, { expiresAt: number; status: ChatTopicStatus }>();

  pin = (topicId: string, status: ChatTopicStatus) => {
    this.#writes.set(topicId, { expiresAt: Date.now() + PENDING_STATUS_TTL_MS, status });
  };

  drop = (topicId: string) => {
    this.#writes.delete(topicId);
  };

  /**
   * Reconcile ONE server-sourced row against the pending optimistic writes.
   *
   * Every path that brings a topic row back from the server must go through
   * here before the row reaches the store — list fetches, search, and the
   * single-topic pull in `syncScheduledTopicRun` alike. A path that bypasses
   * it silently reverts whatever the user just did, and the reader that trips
   * it is usually the one the optimistic write itself woke up.
   *
   * Returns the row to trust: the fetched one, or the fetched one with the
   * pending status re-applied when it predates the write.
   */
  apply = (item: ChatTopic, source: PendingTopicStatusSource): ChatTopic => {
    const pending = this.#writes.get(item.id);
    if (!pending) return item;
    if (pending.expiresAt <= Date.now()) {
      this.#writes.delete(item.id);
      return item;
    }
    if (item.status === pending.status) {
      if (source === 'server') this.#writes.delete(item.id);
      return item;
    }
    return { ...item, status: pending.status };
  };

  /**
   * Apply pending terminal statuses before a fetched topic list enters SWR.
   *
   * Reconciling only in `onData` keeps Zustand correct but is too late for the
   * persisted cache: SWR has already accepted the older raw response and can
   * flush `running` to IndexedDB. After the 15-second pin expires, remounting
   * the sidebar restores that stale spinner. This step deliberately
   * handles statuses only; client-only optimistic rows are still added later by
   * the store's fetched-topic reconciliation and never enter the persisted
   * response. Persisting the pin also means a failed write can survive until the
   * next successful revalidation; that bounded, self-healing window is
   * preferable to reintroducing an older response after a confirmed local
   * terminal event.
   */
  applyAll = (items: ChatTopic[], source: PendingTopicStatusSource): ChatTopic[] => {
    if (this.#writes.size === 0) return items;
    return items.map((item) => this.apply(item, source));
  };

  /**
   * Fold in a server-confirmed compare-and-set away from `from` without adding
   * a pin: its response may already be stale when it lands, so the next fetch
   * has to stay authoritative. A live write to any other status is a newer
   * local transition and wins (returns `false`); a pin still at `from` is
   * exactly what the server just replaced, so it is dropped.
   */
  settle = (topicId: string, from: ChatTopicStatus): boolean => {
    const pending = this.#writes.get(topicId);
    if (pending && pending.expiresAt > Date.now() && pending.status !== from) return false;
    this.#writes.delete(topicId);
    return true;
  };
}
