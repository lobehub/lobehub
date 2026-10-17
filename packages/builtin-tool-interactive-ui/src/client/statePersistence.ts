export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

/** One in-flight write per artifact. Coalesce slider changes; never let an older
 * network response overwrite the most recent selection. Writes are idempotent
 * snapshots, and failed snapshots only retry after an explicit user action. */
export const createStateSaveQueue = <T>(
  save: (value: T) => Promise<void>,
  onStatus: (status: SaveStatus) => void,
) => {
  let pending: T | undefined;
  let failed: T | undefined;
  let running = false;

  const drain = async () => {
    if (running) return;
    running = true;
    onStatus('saving');
    while (pending !== undefined) {
      const value = pending;
      pending = undefined;
      try {
        await save(value);
        failed = undefined;
      } catch {
        // Keep the latest user edit, not a stale failed request. The host shows
        // an actionable error; do not log the user's selections.
        failed = pending ?? value;
        pending = undefined;
        running = false;
        onStatus('failed');
        return;
      }
    }
    running = false;
    onStatus('saved');
  };

  return {
    enqueue(value: T) {
      pending = value;
      failed = undefined;
      void drain();
    },
    retry() {
      if (failed === undefined || running) return;
      pending = failed;
      failed = undefined;
      void drain();
    },
  };
};

interface PendingState<T> {
  status: SaveStatus;
  value: T;
}

/** The registry is keyed by account and source artifact, not a virtualized row. Pending
 * writes and their newest values survive row unmounts; completed entries expire. */
export const createStatePersistenceRegistry = <T>() => {
  const entries = new Map<
    string,
    {
      queue: ReturnType<typeof createStateSaveQueue<T>>;
      snapshot: PendingState<T>;
    }
  >();
  const listeners = new Map<string, Set<(snapshot: PendingState<T>) => void>>();
  const notify = (key: string, snapshot: PendingState<T>) => {
    for (const listener of listeners.get(key) ?? []) listener(snapshot);
  };
  return {
    enqueue(key: string, value: T, save: (value: T) => Promise<void>) {
      let entry = entries.get(key);
      if (!entry) {
        const queue = createStateSaveQueue<T>(save, (status) => {
          const current = entries.get(key);
          if (!current) return;
          current.snapshot = { ...current.snapshot, status };
          if (status === 'saved') entries.delete(key);
          notify(key, current.snapshot);
        });
        entry = { queue, snapshot: { status: 'saving', value } };
        entries.set(key, entry);
      }
      entry.snapshot = { status: 'saving', value };
      notify(key, entry.snapshot);
      entry.queue.enqueue(value);
    },
    peek(key: string) {
      return entries.get(key)?.snapshot;
    },
    retry(key: string) {
      entries.get(key)?.queue.retry();
    },
    subscribe(key: string, listener: (snapshot: PendingState<T>) => void) {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(key);
      };
    },
  };
};
