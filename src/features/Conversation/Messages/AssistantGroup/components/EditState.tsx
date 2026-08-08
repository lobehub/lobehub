import { memo, useEffect, useRef } from 'react';

import { openEditorModal } from '@/features/EditorModal';

import { useConversationStore } from '../../../store';

export interface EditStateProps {
  content: string;
  editorData?: unknown;
  id: string;
}

const EditState = memo<EditStateProps>(({ id, content, editorData }) => {
  const [toggleMessageEditing, updateMessageContent] = useConversationStore((s) => [
    s.toggleMessageEditing,
    s.modifyMessageContent,
  ]);

  // Held in a ref rather than in the effect's deps: the editor snapshots the
  // message when it opens, so a re-render of the streaming group must not tear
  // down and reopen a modal the user is typing in.
  const openEditorRef = useRef<() => ReturnType<typeof openEditorModal>>(undefined);
  openEditorRef.current = () =>
    openEditorModal({
      editorData,
      value: content ? String(content) : '',
      onClose: () => toggleMessageEditing(id, false),
      onConfirm: async (value, newEditorData) => {
        if (!id) return;
        await updateMessageContent(id, value, newEditorData as Record<string, any> | undefined);
        toggleMessageEditing(id, false);
      },
    });

  useEffect(() => {
    if (!id) return;
    const instance = openEditorRef.current!();
    return () => instance.close();
  }, [id]);

  return null;
});

export default EditState;
