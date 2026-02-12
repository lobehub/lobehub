import { Avatar, Block, Flexbox, Input, Popover, stopPropagation } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

import EmojiPicker from '@/components/EmojiPicker';
import { useIsDark } from '@/hooks/useIsDark';
import { useAgentStore } from '@/store/agent';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';

interface EditingProps {
  avatar?: string;
  id: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ id, title, avatar, toggleEditing }) => {
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const isDarkMode = useIsDark();

  const editing = useHomeStore((s) => s.agentRenamingId === id);

  const currentAvatar = avatar || '';

  const [newTitle, setNewTitle] = useState(title);
  const [newAvatar, setNewAvatar] = useState(currentAvatar);

  const handleUpdate = useCallback(async () => {
    const hasChanges =
      (newTitle && title !== newTitle) || (newAvatar && currentAvatar !== newAvatar);

    if (hasChanges) {
      try {
        // Set loading state
        useHomeStore.getState().setAgentUpdatingId(id);

        const updates: { avatar?: string; title?: string } = {};
        if (newTitle && title !== newTitle) updates.title = newTitle;
        if (newAvatar && currentAvatar !== newAvatar) updates.avatar = newAvatar;

        // Use optimisticUpdateAgentMeta to update the specific agent's meta
        await useAgentStore.getState().optimisticUpdateAgentMeta(id, updates);

        // Refresh agent list to update sidebar display (including updatedAt)
        await useHomeStore.getState().refreshAgentList();
      } finally {
        // Clear loading state
        useHomeStore.getState().setAgentUpdatingId(null);
      }
    }
    toggleEditing(false);
  }, [newTitle, newAvatar, title, currentAvatar, id, toggleEditing]);

  return (
    <Popover
      open={editing}
      placement="bottomLeft"
      trigger="click"
      content={
        <Flexbox horizontal gap={4} style={{ width: 320 }} onClick={stopPropagation}>
          <EmojiPicker
            locale={locale}
            shape={'square'}
            value={newAvatar}
            customRender={(avatarValue) => (
              <Block
                clickable
                align={'center'}
                height={36}
                justify={'center'}
                variant={isDarkMode ? 'filled' : 'outlined'}
                width={36}
                onClick={stopPropagation}
              >
                <Avatar emojiScaleWithBackground avatar={avatarValue} shape={'square'} size={32} />
              </Block>
            )}
            onChange={setNewAvatar}
          />
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
