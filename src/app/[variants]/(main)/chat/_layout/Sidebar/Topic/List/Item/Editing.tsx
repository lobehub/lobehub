import { Input } from '@lobehub/ui';
import { Popover } from 'antd';
import { memo, useCallback, useState } from 'react';

import { useChatStore } from '@/store/chat';

interface EditingProps {
  id: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
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
    toggleEditing(false);
  }, [newTitle, title, id, updateTopicTitle, toggleEditing]);

  return (
    <Popover
      arrow={false}
      content={
        <Input
          autoFocus
          defaultValue={title}
          onBlur={() => {
            handleUpdate();
            toggleEditing(false);
          }}
          onChange={(e) => setNewTitle(e.target.value)}
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
