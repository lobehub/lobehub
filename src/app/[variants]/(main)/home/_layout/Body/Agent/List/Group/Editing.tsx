import { Input } from '@lobehub/ui';
import { Popover } from 'antd';
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
      arrow={false}
      content={
        <Input
          autoFocus
          defaultValue={name}
          onBlur={() => {
            handleUpdate();
            toggleEditing(false);
          }}
          onChange={(e) => setNewName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPressEnter={() => {
            handleUpdate();
            toggleEditing(false);
          }}
        />
      }
      destroyOnHidden
      onOpenChange={(open) => {
        if (!open) handleUpdate();
        toggleEditing(open);
      }}
      open={editing}
      placement={'bottomLeft'}
      styles={{
        container: {
          padding: 4,
          width: 320,
        },
      }}
      trigger={['click']}
    >
      <div />
    </Popover>
  );
});

export default Editing;
