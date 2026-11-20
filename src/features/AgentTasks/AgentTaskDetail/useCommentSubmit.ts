import type { IEditor } from '@lobehub/editor';
import { toast } from '@lobehub/ui';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getAttachmentFileIdsFromEditor,
  getEditorAttachmentStateFromJson,
  hasIncompleteEditorAttachments,
} from '@/features/EditorCanvas/editorAttachments';
import { useTaskStore } from '@/store/task';

import { collectMentionLabels } from './commentMentionLabels';

interface UseCommentSubmitOptions {
  canComment: boolean;
  editor: IEditor | undefined;
  /** Called after the input is cleared or restored, so the caller can resync its flags. */
  onContentReset: (state: { hasAttachments: boolean; hasContent: boolean }) => void;
  /** Called once the comment is saved. */
  onSubmitted?: () => void;
  /** Reply in this comment's thread instead of starting a new one. */
  parentCommentId?: string;
  taskId: string;
}

export const useCommentSubmit = ({
  canComment,
  editor,
  onContentReset,
  onSubmitted,
  parentCommentId,
  taskId,
}: UseCommentSubmitOptions) => {
  const { t } = useTranslation('chat');
  const addComment = useTaskStore((s) => s.addComment);
  const [submitting, setSubmitting] = useState(false);
  // `submitting` only updates after a render, so a second Enter in the same
  // tick would still read `false`; the ref closes that window.
  const submittingRef = useRef(false);
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  const submit = useCallback(async () => {
    // A still-uploading image would be sent as its local `blob:` preview URL.
    if (!canComment || submittingRef.current || hasIncompleteEditorAttachments(editor)) return;
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
    let result: Awaited<ReturnType<typeof addComment>>;
    try {
      result = await addComment(taskId, markdown, { editorData: json, parentCommentId });
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
      return;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    onSubmitted?.();

    // Say what became of each @mentioned agent: the comment is saved either
    // way, but whether the agent is now working on it is not visible yet.
    const wakes = result?.wakes ?? [];
    if (wakes.length === 0) return;
    const labels = collectMentionLabels(json);
    for (const { agentId, status } of wakes) {
      const name = labels.get(agentId) ?? t('taskDetail.comment.mention.unnamedAgent');
      const message = t(`taskDetail.comment.wake.${status}`, { name });
      if (status === 'started') toast.success(message);
      else if (status === 'failed') toast.error(message);
      else toast.info(message);
    }
  }, [canComment, editor, onContentReset, onSubmitted, addComment, parentCommentId, t, taskId]);

  return { submit, submitting };
};
