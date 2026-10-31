import { getEditorAttachmentStateFromJson } from '@/features/EditorCanvas/editorAttachments';

interface GoalDraft {
  /** The description editor's JSON document. */
  editorJson: unknown;
  /** Text the modal was opened with (an empty-state example), if any. */
  initialInstruction?: string;
  instruction: string;
  step: 'describe' | 'preparing' | 'review';
}

/**
 * Whether closing the create-goal modal would throw away something the user
 * put in. Past the describe step there is always a drafted plan to lose; an
 * untouched example seed does not count. Attachments count while still
 * uploading or after a failed upload, as they are missing from the markdown.
 */
export const hasUnsavedGoalDraft = ({
  editorJson,
  initialInstruction = '',
  instruction,
  step,
}: GoalDraft): boolean => {
  if (step !== 'describe') return true;

  const text = instruction.trim();
  if (text && text !== initialInstruction.trim()) return true;

  const { hasCompletedAttachments, hasIncompleteAttachments } =
    getEditorAttachmentStateFromJson(editorJson);
  return hasCompletedAttachments || hasIncompleteAttachments;
};
