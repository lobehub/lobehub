import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/vanilla/shallow';

/** What the undo toast and the spec's undo window promise. */
export const UNDO_WINDOW_MS = 8000;
/** The server's cap on ids per write. */
export const MAX_IDS_PER_WRITE = 200;

export const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

export interface MailPatch {
  isStarred?: boolean;
  isUnread?: boolean;
  removed?: boolean;
}

/** A write still on its way to the server, as the screen should already show it. */
export interface MailWrite {
  accountId?: string;
  draftDelta: number;
  id: number;
  ids: string[];
  patch: MailPatch;
  unreadDelta: number;
}

interface MailWritesState {
  writes: MailWrite[];
}

/**
 * Optimistic writes, kept beside the fetched pages rather than edited into them.
 *
 * The 30-second poll replaces the pages at any moment. Because a pending write
 * stays layered on top until its own refresh lands, a poll cannot undo it, and
 * rolling back is only removing the layer.
 */
export const useMailWritesStore = createWithEqualityFn<MailWritesState>()(
  () => ({ writes: [] }),
  shallow,
);

let nextWriteId = 0;

export const mailWriteActions = {
  begin: (write: Omit<MailWrite, 'id'>): number => {
    const id = ++nextWriteId;
    useMailWritesStore.setState((state) => ({ writes: [...state.writes, { ...write, id }] }));
    return id;
  },
  end: (id: number) =>
    useMailWritesStore.setState((state) => ({
      writes: state.writes.filter((write) => write.id !== id),
    })),
};

const sendingByRow = new Map<string, Promise<unknown>>();

/**
 * Send a write once every earlier write touching any of `ids` has settled.
 *
 * The screen shows each write at once, so a person can star and unstar a row
 * before the first request lands. The server applies writes unconditionally,
 * so they must reach it in the order they were made, or the earlier one could
 * land last and win.
 */
export const queueRowWrite = <T>(ids: string[], send: () => Promise<T>): Promise<T> => {
  const earlier = [...new Set(ids)].flatMap((id) => sendingByRow.get(id) ?? []);
  const sent = Promise.allSettled(earlier).then(send);
  const settled = sent.then(
    () => undefined,
    () => undefined,
  );
  for (const id of ids) sendingByRow.set(id, settled);
  void settled.then(() => {
    for (const id of ids) if (sendingByRow.get(id) === settled) sendingByRow.delete(id);
  });
  return sent;
};

/** The rows as the screen should show them, oldest write first so the latest intent wins. */
export const applyMailWrites = <T extends { id: string; isStarred: boolean; isUnread: boolean }>(
  rows: T[],
  writes: MailWrite[],
): T[] => {
  if (writes.length === 0) return rows;

  const patches = new Map<string, MailPatch>();
  for (const write of writes) {
    for (const id of write.ids) patches.set(id, { ...patches.get(id), ...write.patch });
  }

  return rows.flatMap((row) => {
    const patch = patches.get(row.id);
    if (!patch) return [row];
    if (patch.removed) return [];
    const { removed: _removed, ...fields } = patch;
    return [{ ...row, ...fields }];
  });
};

/** What pending writes change in one address's counts. */
export const pendingMailDeltas = (writes: MailWrite[], accountId?: string) =>
  writes
    .filter((write) => write.accountId === accountId)
    .reduce(
      (total, write) => ({
        drafts: total.drafts + write.draftDelta,
        unread: total.unread + write.unreadDelta,
      }),
      { drafts: 0, unread: 0 },
    );
