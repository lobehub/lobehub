import { getEditorAttachmentStateFromJson } from '@/features/EditorCanvas/editorAttachments';

interface TaskDraft {
  /** The instruction editor's JSON document. */
  editorJson: unknown;
  instruction: string;
  title: string;
}

/**
 * Whether closing the create-task modal would throw away something the user
 * put in. Attachments count while still uploading or after a failed upload:
 * they are visible in the draft but missing from the markdown instruction.
 */
export const hasUnsavedTaskDraft = ({ editorJson, instruction, title }: TaskDraft): boolean => {
  if (title.trim() || instruction.trim()) return true;

  const { hasCompletedAttachments, hasIncompleteAttachments } =
    getEditorAttachmentStateFromJson(editorJson);
  return hasCompletedAttachments || hasIncompleteAttachments;
};
