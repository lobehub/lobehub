import { Input, stopPropagation } from '@lobehub/ui';
import { type InputRef, Popover } from 'antd';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

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

  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (editing) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [editing]);

  const handleUpdate = useCallback(async () => {
    if (newName && name !== newName) {
      try {
        useHomeStore.getState().setGroupUpdatingId(id);
        await updateGroupName(id, newName);
      } finally {
        useHomeStore.getState().setGroupUpdatingId(null);
      }
    }
    toggleEditing(false);
  }, [newName, name, id, updateGroupName, toggleEditing]);

  return (
    <Popover
      open={editing}
      overlayInnerStyle={{ padding: 4, width: 320 }}
      placement="bottomLeft"
      trigger="click"
      content={
        <Input
          defaultValue={name}
          ref={inputRef}
          onBlur={() => handleUpdate()}
          onChange={(e) => setNewName(e.target.value)}
          onClick={stopPropagation}
          onPressEnter={() => handleUpdate()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') toggleEditing(false);
          }}
        />
      }
    >
      <div />
    </Popover>
  );
});

export default Editing;
