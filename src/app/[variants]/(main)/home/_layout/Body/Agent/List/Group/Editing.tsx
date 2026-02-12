import { Input, Popover, stopPropagation } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

import { useHomeStore } from '@/store/home';

interface EditingProps {
  id: string;
  name: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ id, name, toggleEditing }) => {
  const [newName, setNewName] = useState(name);
  const [editing, updateGroupName] = useHomeStore((s) => [
    s.groupRenamingId === id,
    s.updateGroupName,
  ]);

  const handleUpdate = useCallback(async () => {
    if (newName && name !== newName) {
      try {
        // Set loading state
        useHomeStore.getState().setGroupUpdatingId(id);
        await updateGroupName(id, newName);
      } finally {
        // Clear loading state
        useHomeStore.getState().setGroupUpdatingId(null);
      }
    }
    toggleEditing(false);
  }, [newName, name, id, updateGroupName, toggleEditing]);

  return (
    <Popover
      open={editing}
      placement="bottomLeft"
      trigger="click"
      content={
        <Input
          autoFocus
          defaultValue={name}
          onChange={(e) => setNewName(e.target.value)}
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
