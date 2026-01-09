import { memo } from 'react';

import { EditorModal } from '@/features/EditorModal';

import { useConversationStore } from '../../../store';

export interface EditStateProps {
  content: string;
  id: string;
}

const EditState = memo<EditStateProps>(({ id, content }) => {
  const [toggleMessageEditing, updateMessageContent] = useConversationStore((s) => [
    s.toggleMessageEditing,
    s.modifyMessageContent,
  ]);

  return (
    <EditorModal
      onCancel={() => {
        toggleMessageEditing(id, false);
      }}
      onConfirm={async (value) => {
        if (!id) return;
        await updateMessageContent(id, value);
        toggleMessageEditing(id, false);
      }}
      open={!!id}
      value={content ? String(content) : ''}
    />
  );
});

export default EditState;
