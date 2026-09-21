import { extractMentionedUserIds } from './commentMentions';

/**
 * Member ids that are @-mentioned in `nextEditorData` but not in
 * `previousEditorData`. A document is saved repeatedly while it is being
 * written (autosave), so only the mentions added by this save may notify —
 * members already present in the previous snapshot were pinged by the save
 * that introduced them. Removing and re-adding the same chip counts as a new
 * mention again.
 */
export const diffAddedMentionUserIds = (
  previousEditorData: unknown,
  nextEditorData: unknown,
): string[] => {
  const previousUserIds = new Set(extractMentionedUserIds(previousEditorData));

  return extractMentionedUserIds(nextEditorData).filter((userId) => !previousUserIds.has(userId));
};
