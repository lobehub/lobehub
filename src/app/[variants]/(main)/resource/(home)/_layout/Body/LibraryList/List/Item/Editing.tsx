import { Input, Popover } from '@lobehub/ui';
import { memo, useCallback, useEffect, useState } from 'react';

import { useKnowledgeBaseStore } from '@/store/library';

interface EditingProps {
  id: string;
  name: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ id, name, toggleEditing }) => {
  const [editing, updateKnowledgeBase] = useKnowledgeBaseStore((s) => [
    s.knowledgeBaseRenamingId === id,
    s.updateKnowledgeBase,
  ]);

  const [newName, setNewName] = useState(name);

  // Reset state when editing starts
  useEffect(() => {
    if (editing) {
      setNewName(name);
    }
  }, [editing, name]);

  const handleUpdate = useCallback(() => {
    if (newName && name !== newName) {
      updateKnowledgeBase(id, { name: newName });
    }
    toggleEditing(false);
  }, [newName, name, id, updateKnowledgeBase, toggleEditing]);

  return (
    <Popover
      content={
        <Input
          autoFocus
          defaultValue={name}
          maxLength={64}
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
      onOpenChange={(open) => {
        if (!open) handleUpdate();
        toggleEditing(open);
      }}
      open={editing}
      placement="bottomLeft"
      styles={{
        content: {
          padding: 4,
          width: 320,
        },
      }}
      trigger="click"
    >
      <div />
    </Popover>
  );
});

export default Editing;
