import { Flexbox, Input, stopPropagation } from '@lobehub/ui';
import { type InputRef } from 'antd';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { useHomeStore } from '@/store/home';

interface GroupContentProps {
  id: string;
  onClose: () => void;
  title: string;
  type: 'group' | 'agentGroup';
}

const GroupContent = memo<GroupContentProps>(({ id, title, type, onClose }) => {
  const [newTitle, setNewTitle] = useState(title);

  const handleUpdate = useCallback(async () => {
    if (newTitle && title !== newTitle) {
      try {
        useHomeStore.getState().setGroupUpdatingId(id);

        if (type === 'group') {
          await useHomeStore.getState().updateGroupName(id, newTitle);
        } else {
          await useHomeStore.getState().renameAgentGroup(id, newTitle);
        }
      } finally {
        useHomeStore.getState().setGroupUpdatingId(null);
      }
    }
    onClose();
  }, [newTitle, title, id, type, onClose]);
  const inputRef = useRef<InputRef>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      });
    });
  }, []);

  return (
    <Flexbox horizontal gap={4} style={{ width: 320 }} onClick={stopPropagation}>
      <Input
        defaultValue={title}
        ref={inputRef}
        style={{ flex: 1 }}
        onChange={(e) => setNewTitle(e.target.value)}
        onPressEnter={handleUpdate}
      />
    </Flexbox>
  );
});

export default GroupContent;
