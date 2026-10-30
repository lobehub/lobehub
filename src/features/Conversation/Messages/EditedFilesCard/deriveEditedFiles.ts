import type { EditedFileEntry } from '@lobechat/builtin-tools/fileEditScan';

export interface EditedFilesTotals {
  linesAdded: number;
  linesDeleted: number;
}

/** Sum the per-file line deltas for the card's git-diff-stat style header. */
export const summarizeEditedFilesTotals = (entries: EditedFileEntry[]): EditedFilesTotals =>
  entries.reduce<EditedFilesTotals>(
    (totals, entry) => ({
      linesAdded: totals.linesAdded + entry.linesAdded,
      linesDeleted: totals.linesDeleted + entry.linesDeleted,
    }),
    { linesAdded: 0, linesDeleted: 0 },
  );
