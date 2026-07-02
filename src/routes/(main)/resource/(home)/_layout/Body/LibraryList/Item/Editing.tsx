import { Input, stopPropagation } from '@lobehub/ui';
import { type InputRef } from 'antd';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';

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
  const inputRef = useRef<InputRef>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!editing) return;

    setNewName(name);
    submittingRef.current = false;

    queueMicrotask(() => {
      inputRef.current?.input?.focus();
      inputRef.current?.input?.select();
    });
  }, [editing, name]);

  const handleUpdate = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    const value = newName.trim();
    if (value && value !== name) {
      await updateKnowledgeBase(id, { name: value });
    }

    toggleEditing(false);
  }, [id, name, newName, toggleEditing, updateKnowledgeBase]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        toggleEditing(false);
      }
    },
    [toggleEditing],
  );

  if (!editing) return null;

  return (
    <Input
      maxLength={64}
      ref={inputRef}
      size="small"
      style={{ width: '100%' }}
      value={newName}
      onBlur={() => void handleUpdate()}
      onChange={(e) => setNewName(e.target.value)}
      onClick={stopPropagation}
      onKeyDown={handleKeyDown}
      onMouseDown={stopPropagation}
      onPressEnter={() => void handleUpdate()}
    />
  );
});

export default Editing;
