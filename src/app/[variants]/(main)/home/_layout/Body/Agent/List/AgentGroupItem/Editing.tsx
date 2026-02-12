import { Flexbox, Input, Popover, stopPropagation } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

import { useHomeStore } from '@/store/home';

interface EditingProps {
  id: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ id, title, toggleEditing }) => {
  const editing = useHomeStore((s) => s.groupRenamingId === id);

  const [newTitle, setNewTitle] = useState(title);

  const handleUpdate = useCallback(async () => {
    const hasChanges = newTitle && title !== newTitle;

    if (hasChanges) {
      try {
        useHomeStore.getState().setGroupUpdatingId(id);
        await useHomeStore.getState().renameAgentGroup(id, newTitle);
      } finally {
        useHomeStore.getState().setGroupUpdatingId(null);
      }
    }
    toggleEditing(false);
  }, [newTitle, title, id, toggleEditing]);

  return (
    <Popover
      open={editing}
      placement="bottomLeft"
      trigger="click"
      content={
        <Flexbox horizontal gap={4} style={{ width: 280 }} onClick={stopPropagation}>
          <Input
            autoFocus
            defaultValue={title}
            style={{ flex: 1 }}
            onChange={(e) => setNewTitle(e.target.value)}
            onPressEnter={() => {
              handleUpdate();
              toggleEditing(false);
            }}
          />
        </Flexbox>
      }
      styles={{
        content: {
          padding: 4,
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
