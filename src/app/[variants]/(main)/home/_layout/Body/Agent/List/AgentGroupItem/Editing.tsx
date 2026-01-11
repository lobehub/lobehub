import { Flexbox, Input, Popover } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

import { useHomeStore } from '@/store/home';

interface EditingProps {
  id: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ id, title, toggleEditing }) => {
  const editing = useHomeStore((s) => s.agentRenamingId === id);

  const [newTitle, setNewTitle] = useState(title);

  const handleUpdate = useCallback(async () => {
    const hasChanges = newTitle && title !== newTitle;

    if (hasChanges) {
      try {
        // Set loading state
        useHomeStore.getState().setAgentUpdatingId(id);

        // TODO: Add group title update logic here
        // await updateGroupTitle(id, newTitle);

        // Refresh agent list to update sidebar display
        await useHomeStore.getState().refreshAgentList();
      } finally {
        // Clear loading state
        useHomeStore.getState().setAgentUpdatingId(null);
      }
    }
    toggleEditing(false);
  }, [newTitle, title, id, toggleEditing]);

  return (
    <Popover
      content={
        <Flexbox gap={4} horizontal onClick={(e) => e.stopPropagation()} style={{ width: 280 }}>
          <Input
            autoFocus
            defaultValue={title}
            onChange={(e) => setNewTitle(e.target.value)}
            onPressEnter={() => {
              handleUpdate();
              toggleEditing(false);
            }}
            style={{ flex: 1 }}
          />
        </Flexbox>
      }
      onOpenChange={(open) => {
        if (!open) handleUpdate();
        toggleEditing(open);
      }}
      open={editing}
      placement="bottomLeft"
      styles={{
        content: {
          padding: 4,
        },
      }}
      trigger="click"
    >
      <div />
    </Popover>
  );
});

export default Editing;
