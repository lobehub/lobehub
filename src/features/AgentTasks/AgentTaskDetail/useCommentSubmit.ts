import type { IEditor } from '@lobehub/editor';
import { useCallback, useRef, useState } from 'react';

import {
  getAttachmentFileIdsFromEditor,
  getEditorAttachmentStateFromJson,
} from '@/features/EditorCanvas/editorAttachments';
import { useTaskStore } from '@/store/task';

interface UseCommentSubmitOptions {
  canComment: boolean;
  editor: IEditor | undefined;
  /** Called after the input is cleared or restored, so the caller can resync its flags. */
  onContentReset: (state: { hasAttachments: boolean; hasContent: boolean }) => void;
  taskId: string;
}

export const useCommentSubmit = ({
  canComment,
  editor,
  onContentReset,
  taskId,
}: UseCommentSubmitOptions) => {
  const addComment = useTaskStore((s) => s.addComment);
  const [submitting, setSubmitting] = useState(false);
  // `submitting` only updates after a render, so a second Enter in the same
  // tick would still read `false`; the ref closes that window.
  const submittingRef = useRef(false);
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  const submit = useCallback(async () => {
    if (!canComment || submittingRef.current) return;
    const json = editor?.getDocument?.('json') as unknown;
    const markdown = String(editor?.getDocument?.('markdown') ?? '').trim();
    const hasFiles = getAttachmentFileIdsFromEditor(editor).length > 0;
    if (!markdown && !hasFiles) return;

    // The optimistic row appears as soon as `addComment` starts, but the call
    // only resolves after the mutation *and* the detail refetch. Clear the
    // input now so a slow network doesn't leave the sent text sitting there,
    // inviting a duplicate send; put it back if the send fails.
    submittingRef.current = true;
    setSubmitting(true);
    editor?.cleanDocument?.();
    onContentReset({ hasAttachments: false, hasContent: false });
    try {
      await addComment(taskId, markdown, { editorData: json });
    } catch {
      // The tRPC error link already reports the failure; keep the text —
      // unless the user has started a new comment or moved to another task
      // while it was sending, which a restore would overwrite or misplace.
      // Count still-uploading attachments too: they have no file id yet.
      const attachments = getEditorAttachmentStateFromJson(editor?.getDocument?.('json'));
      const isEmpty =
        !String(editor?.getDocument?.('markdown') ?? '').trim() &&
        !attachments.hasCompletedAttachments &&
        !attachments.hasIncompleteAttachments;
      if (!isEmpty || taskIdRef.current !== taskId) return;
      if (json) editor?.setDocument?.('json', json);
      else editor?.setDocument?.('markdown', markdown);
      onContentReset({ hasAttachments: hasFiles, hasContent: !!markdown });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [canComment, editor, onContentReset, addComment, taskId]);

  return { submit, submitting };
};
