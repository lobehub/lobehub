import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/vanilla/shallow';

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
