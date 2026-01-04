import { Avatar, Block, Flexbox, Input } from '@lobehub/ui';
import { Popover } from 'antd';
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
      arrow={false}
      content={
        <Flexbox gap={4} horizontal onClick={(e) => e.stopPropagation()} style={{ width: 320 }}>
          <EmojiPicker
            customRender={(avatarValue) => (
              <Block
                align={'center'}
                clickable
                height={36}
                justify={'center'}
                onClick={(e) => e.stopPropagation()}
                variant={isDarkMode ? 'filled' : 'outlined'}
                width={36}
              >
                <Avatar avatar={avatarValue} emojiScaleWithBackground shape={'square'} size={32} />
              </Block>
            )}
            locale={locale}
            onChange={setNewAvatar}
            shape={'square'}
            value={newAvatar}
          />
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
        },
      }}
      trigger={['click']}
    >
      <div />
    </Popover>
  );
});

export default Editing;
