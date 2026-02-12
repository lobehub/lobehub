import { DEFAULT_AVATAR } from '@lobechat/const';
import { Flexbox, Input, stopPropagation } from '@lobehub/ui';
import { type InputRef, message, Popover } from 'antd';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useAgentStore } from '@/store/agent';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';

const MAX_AVATAR_SIZE = 1024 * 1024;

interface EditingProps {
  avatar?: string;
  id: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ id, title, avatar, toggleEditing }) => {
  const { t } = useTranslation('setting');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const editing = useHomeStore((s) => s.agentRenamingId === id);
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  const currentAvatar = avatar || DEFAULT_AVATAR;

  const [newTitle, setNewTitle] = useState(title);
  const [newAvatar, setNewAvatar] = useState(currentAvatar);
  const [uploading, setUploading] = useState(false);

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
    toggleEditing(false);
  }, [newTitle, newAvatar, title, currentAvatar, id, toggleEditing]);

  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (file.size > MAX_AVATAR_SIZE) {
        message.error(t('settingAgent.avatar.sizeExceeded'));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (result?.url) {
          setNewAvatar(result.url);
        }
      } finally {
        setUploading(false);
      }
    },
    [uploadWithProgress, t],
  );

  const handleAvatarDelete = useCallback(() => {
    setNewAvatar(DEFAULT_AVATAR);
  }, []);

  return (
    <Popover
      arrow={false}
      open={editing}
      overlayInnerStyle={{ padding: 4 }}
      placement="bottomLeft"
      trigger="click"
      content={
        <Flexbox horizontal gap={4} style={{ width: 320 }} onClick={stopPropagation}>
          <EmojiPicker
            allowUpload
            allowDelete={!!newAvatar && newAvatar !== DEFAULT_AVATAR}
            loading={uploading}
            locale={locale}
            shape={'square'}
            size={36}
            value={newAvatar}
            onChange={setNewAvatar}
            onDelete={handleAvatarDelete}
            onUpload={handleAvatarUpload}
          />
          <Input
            defaultValue={title}
            ref={inputRef}
            style={{ flex: 1 }}
            onChange={(e) => setNewTitle(e.target.value)}
            onPressEnter={() => handleUpdate()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') toggleEditing(false);
            }}
          />
        </Flexbox>
      }
      onOpenChange={(open) => {
        if (!open) handleUpdate();
      }}
    >
      <div />
    </Popover>
  );
});

export default Editing;
