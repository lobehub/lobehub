import { memo, useCallback } from 'react';

import InlineRename from '@/components/InlineRename';
import { useChatStore } from '@/store/chat';

interface EditingProps {
  id: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ id, title, toggleEditing }) => {
  const [editing, updateThreadTitle] = useChatStore((s) => [
    s.threadRenamingId === id,
    s.updateThreadTitle,
  ]);

  const handleSave = useCallback(
    async (newTitle: string) => {
      await updateThreadTitle(id, newTitle);
    },
    [id, updateThreadTitle],
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
