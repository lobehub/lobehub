import { ActionIcon, Avatar, Block, Flexbox, Input, stopPropagation } from '@lobehub/ui';
import { type InputRef, message } from 'antd';
import { Check } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import GroupAvatar from '@/features/GroupAvatar';
import { useIsDark } from '@/hooks/useIsDark';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';

const MAX_AVATAR_SIZE = 1024 * 1024;

interface GroupContentProps {
  avatar?: string;
  id: string;
  memberAvatars?: { avatar?: string; background?: string }[];
  onClose: () => void;
  title: string;
  type: 'group' | 'agentGroup';
}

const GroupContent = memo<GroupContentProps>(
  ({ id, title, avatar, memberAvatars, type, onClose }) => {
    const { t } = useTranslation('setting');
    const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
    const isDarkMode = useIsDark();
    const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

    const isAgentGroup = type === 'agentGroup';

    const [newTitle, setNewTitle] = useState(title);
    const [newAvatar, setNewAvatar] = useState<string | null | undefined>(avatar);
    const [uploading, setUploading] = useState(false);

    const handleUpdate = useCallback(async () => {
      const titleChanged = newTitle && title !== newTitle;
      const avatarChanged = isAgentGroup && newAvatar !== avatar;

      if (titleChanged || avatarChanged) {
        try {
          useHomeStore.getState().setGroupUpdatingId(id);

          if (type === 'group') {
            await useHomeStore.getState().updateGroupName(id, newTitle);
          } else {
            await useHomeStore
              .getState()
              .renameAgentGroup(id, newTitle || title, avatarChanged ? newAvatar : undefined);
          }
        } finally {
          useHomeStore.getState().setGroupUpdatingId(null);
        }
      }
      onClose();
    }, [newTitle, newAvatar, title, avatar, id, type, isAgentGroup, onClose]);

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
      setNewAvatar(null);
    }, []);

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
        {isAgentGroup && (
          <EmojiPicker
            allowUpload
            allowDelete={!!newAvatar}
            loading={uploading}
            locale={locale}
            shape={'square'}
            value={newAvatar ?? undefined}
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
                {avatarValue ? (
                  <Avatar
                    emojiScaleWithBackground
                    avatar={avatarValue}
                    shape={'square'}
                    size={32}
                  />
                ) : (
                  <GroupAvatar avatars={memberAvatars || []} size={32} />
                )}
              </Block>
            )}
            onChange={setNewAvatar}
            onDelete={handleAvatarDelete}
            onUpload={handleAvatarUpload}
          />
        )}
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
  },
);

export default GroupContent;
