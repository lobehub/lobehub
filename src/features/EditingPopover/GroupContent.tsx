import {
  ActionIcon,
  Avatar,
  Block,
  Flexbox,
  Icon,
  Input,
  stopPropagation,
  Tooltip,
} from '@lobehub/ui';
import { type InputRef, message } from 'antd';
import { Check, PaletteIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import BackgroundSwatches from '@/features/AgentSetting/AgentMeta/BackgroundSwatches';
import GroupAvatar from '@/features/GroupAvatar';
import { useIsDark } from '@/hooks/useIsDark';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';

const MAX_AVATAR_SIZE = 1024 * 1024;

interface GroupContentProps {
  avatar?: string;
  backgroundColor?: string;
  id: string;
  memberAvatars?: { avatar?: string; background?: string }[];
  onClose: () => void;
  title: string;
  type: 'group' | 'agentGroup';
}

const GroupContent = memo<GroupContentProps>(
  ({ id, title, avatar, backgroundColor, memberAvatars, type, onClose }) => {
    const { t } = useTranslation('setting');
    const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
    const isDarkMode = useIsDark();
    const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

    const isAgentGroup = type === 'agentGroup';

    const [newTitle, setNewTitle] = useState(title);
    const [newAvatar, setNewAvatar] = useState<string | null | undefined>(avatar);
    const [newBackgroundColor, setNewBackgroundColor] = useState(backgroundColor);
    const [uploading, setUploading] = useState(false);

    const handleUpdate = useCallback(async () => {
      const titleChanged = newTitle && title !== newTitle;
      const avatarChanged = isAgentGroup && newAvatar !== avatar;
      const backgroundColorChanged = isAgentGroup && newBackgroundColor !== backgroundColor;

      if (titleChanged || avatarChanged || backgroundColorChanged) {
        try {
          useHomeStore.getState().setGroupUpdatingId(id);

          if (type === 'group') {
            await useHomeStore.getState().updateGroupName(id, newTitle);
          } else {
            await useHomeStore
              .getState()
              .renameAgentGroup(
                id,
                newTitle || title,
                avatarChanged ? newAvatar : undefined,
                backgroundColorChanged ? newBackgroundColor : undefined,
              );
          }
        } finally {
          useHomeStore.getState().setGroupUpdatingId(null);
        }
      }
      onClose();
    }, [
      newTitle,
      newAvatar,
      newBackgroundColor,
      title,
      avatar,
      backgroundColor,
      id,
      type,
      isAgentGroup,
      onClose,
    ]);

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
            background={
              newBackgroundColor && newBackgroundColor !== 'rgba(0,0,0,0)'
                ? newBackgroundColor
                : undefined
            }
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
                    background={
                      newBackgroundColor && newBackgroundColor !== 'rgba(0,0,0,0)'
                        ? newBackgroundColor
                        : undefined
                    }
                  />
                ) : (
                  <GroupAvatar
                    avatars={memberAvatars || []}
                    background={newBackgroundColor}
                    size={32}
                  />
                )}
              </Block>
            )}
            customTabs={[
              {
                label: (
                  <Tooltip title={t('settingAgent.backgroundColor.title')}>
                    <Icon icon={PaletteIcon} size={{ size: 20, strokeWidth: 2.5 }} />
                  </Tooltip>
                ),
                render: () => (
                  <Flexbox padding={8} width={332}>
                    <BackgroundSwatches
                      gap={8}
                      shape={'square'}
                      size={38}
                      value={newBackgroundColor}
                      onChange={setNewBackgroundColor}
                    />
                  </Flexbox>
                ),
                value: 'background',
              },
            ]}
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
