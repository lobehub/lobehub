/** The part of a mail these rules read, so they stay testable without a full row. */
export interface ConversationMail {
  id: string;
  isUnread: boolean;
}

/** Collapsed mails in a row beyond this fold into one "show N more" line. */
export const FOLD_RUN_THRESHOLD = 6;

/** Open by default: every unread mail, and always the newest. */
export const initialExpandedIds = (mails: ConversationMail[]): Set<string> => {
  const expanded = new Set(mails.filter((mail) => mail.isUnread).map((mail) => mail.id));
  const last = mails.at(-1);
  if (last) expanded.add(last.id);
  return expanded;
};

/** Only what opening actually shows is read, so a fold never hides an unread mail. */
export const idsToMarkReadOnOpen = (mails: ConversationMail[]): string[] =>
  mails.filter((mail) => mail.isUnread).map((mail) => mail.id);

/** Where the reader starts: the first unread, else the newest. */
export const initialFocusId = (mails: ConversationMail[]): string | undefined =>
  (mails.find((mail) => mail.isUnread) ?? mails.at(-1))?.id;

export type ConversationRow =
  { id: string; kind: 'mail' } | { count: number; firstHiddenIndex: number; kind: 'fold' };

/** Long runs of collapsed mail become one line; the runs either side stay visible. */
export const buildConversationRows = (
  mails: ConversationMail[],
  expanded: Set<string>,
  unfolded: boolean,
): ConversationRow[] => {
  if (unfolded) return mails.map(({ id }) => ({ id, kind: 'mail' }));

  const rows: ConversationRow[] = [];
  let index = 0;

  while (index < mails.length) {
    let end = index;
    while (end < mails.length && !expanded.has(mails[end].id)) end += 1;
    const run = end - index;

    if (run >= FOLD_RUN_THRESHOLD) {
      rows.push({ id: mails[index].id, kind: 'mail' });
      rows.push({ count: run - 2, firstHiddenIndex: index + 1, kind: 'fold' });
      rows.push({ id: mails[end - 1].id, kind: 'mail' });
    } else {
      for (let cursor = index; cursor < end; cursor += 1) {
        rows.push({ id: mails[cursor].id, kind: 'mail' });
      }
    }

    if (end < mails.length) rows.push({ id: mails[end].id, kind: 'mail' });
    index = end + 1;
  }

  return rows;
};

export interface ConversationNeighbors {
  /** Older, towards the bottom. */
  nextId?: string;
  /** Newer, towards the top of the list. */
  previousId?: string;
  /** The row standing for the open conversation itself. */
  rowId?: string;
}

/**
 * The list rows either side of the open conversation. A row stands for its
 * whole conversation under one of its mails' ids, which need not be the one
 * the URL names, so the row is found by any of them.
 */
export const findNeighbors = (
  rows: { id: string }[],
  conversationIds: ReadonlySet<string>,
): ConversationNeighbors => {
  const index = rows.findIndex((row) => conversationIds.has(row.id));
  if (index === -1) return {};

  return { nextId: rows[index + 1]?.id, previousId: rows[index - 1]?.id, rowId: rows[index].id };
};

/** Where to land after this conversation leaves the list: older first, else newer. */
export const nextSelectionAfterRemoval = ({ nextId, previousId }: ConversationNeighbors) =>
  nextId ?? previousId;
