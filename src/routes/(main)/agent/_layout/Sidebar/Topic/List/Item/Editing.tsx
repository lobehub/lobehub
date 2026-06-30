import { memo, useCallback } from 'react';

import InlineRename from '@/components/InlineRename';
import { useChatStore } from '@/store/chat';

interface EditingProps {
  id: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ id, title, toggleEditing }) => {
  const [editing, updateTopicTitle] = useChatStore((s) => [
    s.topicRenamingId === id,
    s.updateTopicTitle,
  ]);

  const handleSave = useCallback(
    async (newTitle: string) => {
      await updateTopicTitle(id, newTitle);
    },
    [id, updateTopicTitle],
  );

  return (
    <InlineRename
      open={editing}
      title={title}
      onOpenChange={(open) => toggleEditing(open)}
      onSave={handleSave}
    />
  );
});

export default Editing;
