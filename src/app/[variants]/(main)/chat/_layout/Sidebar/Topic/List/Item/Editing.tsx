import { Input, type InputProps, Popover } from '@lobehub/ui';
import type { InputRef } from 'antd';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { useChatStore } from '@/store/chat';

interface EditingProps {
  id: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
}

function FocusableInput({ ...props }: InputProps) {
  const ref = useRef<InputRef>(null);
  useEffect(() => {
    queueMicrotask(() => {
      if (ref.current) {
        ref.current.input?.focus();
      }
    });
  }, []);
  return <Input {...props} ref={ref} />;
}

const Editing = memo<EditingProps>(({ id, title, toggleEditing }) => {
  const [newTitle, setNewTitle] = useState(title);
  const [editing, updateTopicTitle] = useChatStore((s) => [
    s.topicRenamingId === id,
    s.updateTopicTitle,
  ]);

  const handleUpdate = useCallback(async () => {
    if (newTitle && title !== newTitle) {
      try {
        // Set loading state
        useChatStore.setState(
          {
            topicLoadingIds: [...useChatStore.getState().topicLoadingIds, id],
          },
          false,
          'setTopicUpdating',
        );
        await updateTopicTitle(id, newTitle);
      } finally {
        // Clear loading state
        useChatStore.setState(
          {
            topicLoadingIds: useChatStore
              .getState()
              .topicLoadingIds.filter((loadingId) => loadingId !== id),
          },
          false,
          'clearTopicUpdating',
        );
      }
    }
  }, [newTitle, title, id, updateTopicTitle, toggleEditing]);

  return (
    <Popover
      content={
        <FocusableInput
          defaultValue={title}
          onBlur={handleUpdate}
          onChange={(e) => setNewTitle(e.target.value)}
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
