import { memo } from 'react';

import { EditorModal } from '@/features/EditorModal';

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

  return (
    <EditorModal
      editorData={editorData}
      open={!!id}
      value={content ? String(content) : ''}
      onCancel={() => {
        toggleMessageEditing(id, false);
      }}
      onConfirm={async (value, newEditorData) => {
        if (!id) return;
        await updateMessageContent(id, value, newEditorData as Record<string, any> | undefined);
        toggleMessageEditing(id, false);
      }}
    />
  );
});

export default EditState;
