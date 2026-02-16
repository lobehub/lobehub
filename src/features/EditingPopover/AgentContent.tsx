import { ActionIcon, Avatar, Block, Flexbox, Input, stopPropagation } from '@lobehub/ui';
import { type InputRef } from 'antd';
import { Check } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import EmojiPicker from '@/components/EmojiPicker';
import { useIsDark } from '@/hooks/useIsDark';
import { useAgentStore } from '@/store/agent';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';

interface AgentContentProps {
  avatar?: string;
  id: string;
  onClose: () => void;
  title: string;
}

const AgentContent = memo<AgentContentProps>(({ id, title, avatar, onClose }) => {
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const isDarkMode = useIsDark();

  const currentAvatar = avatar || '';

  const [newTitle, setNewTitle] = useState(title);
  const [newAvatar, setNewAvatar] = useState(currentAvatar);

  const handleUpdate = useCallback(async () => {
    const hasChanges =
      (newTitle && title !== newTitle) || (newAvatar && currentAvatar !== newAvatar);

    if (hasChanges) {
      try {
        useHomeStore.getState().setAgentUpdatingId(id);

        const updates: { avatar?: string; title?: string } = {};
        if (newTitle && title !== newTitle) updates.title = newTitle;
        if (newAvatar && currentAvatar !== newAvatar) updates.avatar = newAvatar;

        await useAgentStore.getState().optimisticUpdateAgentMeta(id, updates);
        await useHomeStore.getState().refreshAgentList();
      } finally {
        useHomeStore.getState().setAgentUpdatingId(null);
      }
    }
    onClose();
  }, [newTitle, newAvatar, title, currentAvatar, id, onClose]);
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
    <Flexbox horizontal align={'center'} gap={4} style={{ width: 320 }} onClick={stopPropagation}>
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
        defaultValue={title}
        ref={inputRef}
        style={{ flex: 1 }}
        onChange={(e) => setNewTitle(e.target.value)}
        onPressEnter={handleUpdate}
      />
      <ActionIcon icon={Check} size={'small'} onClick={handleUpdate} />
    </Flexbox>
  );
});

export default AgentContent;
