import { Input, Popover, stopPropagation } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

import { useChatStore } from '@/store/chat';

interface EditingProps {
  id: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ id, title, toggleEditing }) => {
  const [newTitle, setNewTitle] = useState(title);
  const [editing, updateThreadTitle] = useChatStore((s) => [
    s.threadRenamingId === id,
    s.updateThreadTitle,
  ]);

  const handleUpdate = useCallback(async () => {
    if (newTitle && title !== newTitle) {
      await updateThreadTitle(id, newTitle);
    }
    toggleEditing(false);
  }, [newTitle, title, id, updateThreadTitle, toggleEditing]);

  return (
    <Popover
      open={editing}
      placement="bottomLeft"
      trigger="click"
      content={
        <Input
          autoFocus
          defaultValue={title}
          onChange={(e) => setNewTitle(e.target.value)}
          onClick={stopPropagation}
          onBlur={() => {
            handleUpdate();
            toggleEditing(false);
          }}
          onPressEnter={() => {
            handleUpdate();
            toggleEditing(false);
          }}
        />
      }
      styles={{
        content: {
          padding: 4,
          width: 320,
        },
      }}
      onOpenChange={(open) => {
        if (!open) handleUpdate();
        toggleEditing(open);
      }}
    >
      <div />
    </Popover>
  );
});

export default Editing;
