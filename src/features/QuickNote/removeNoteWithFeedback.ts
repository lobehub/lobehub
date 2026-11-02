import { toast } from '@lobehub/ui';

/**
 * Deletes a Quick Note from a confirm dialog and reports a failure instead of leaving an unhandled
 * rejection behind a closed dialog.
 *
 * Returns:
 * - `true` when the note was removed (after `onRemoved` ran), `false` when removal failed and the
 *   failure toast was shown.
 */
export const removeNoteWithFeedback = async ({
  failedMessage,
  id,
  onRemoved,
  removeNote,
}: {
  failedMessage: string;
  id: string;
  onRemoved?: () => void;
  removeNote: (id: string) => Promise<void>;
}) => {
  try {
    await removeNote(id);
  } catch (error) {
    console.error('[QuickNote] Failed to remove note:', error);
    toast.error(failedMessage);
    return false;
  }
  onRemoved?.();
  return true;
};
