'use client';

import { EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import { Block, Flexbox, Icon, Input, Skeleton, Tooltip } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { message } from 'antd';
import isEqual from 'fast-deep-equal';
import { PaletteIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GroupAvatar from '@/app/[variants]/(main)/group/features/GroupAvatar';
import EmojiPicker from '@/components/EmojiPicker';
import BackgroundSwatches from '@/features/AgentSetting/AgentMeta/BackgroundSwatches';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

const MAX_AVATAR_SIZE = 1024 * 1024; // 1MB limit for server actions

const GroupHeader = memo(() => {
  const { t } = useTranslation('agentGroup');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  // Get group meta from agentGroup store
  const groupMeta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta, isEqual);
  const updateGroupMeta = useAgentGroupStore((s) => s.updateGroupMeta);

  // File upload
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [uploading, setUploading] = useState(false);

  // Local state for inputs
  const [localTitle, setLocalTitle] = useState(groupMeta.title || '');

  // Sync local state when meta changes from external source
  useEffect(() => {
    setLocalTitle(groupMeta.title || '');
  }, [groupMeta.title]);

  // Debounced save for title
  const { run: debouncedSaveTitle } = useDebounceFn(
    (value: string) => {
      updateGroupMeta({ title: value });
    },
    { wait: EDITOR_DEBOUNCE_TIME },
  );

  // Handle avatar change (immediate save)
  const handleAvatarChange = (emoji: string) => {
    updateGroupMeta({ avatar: emoji });
  };

  // Handle avatar upload
  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (file.size > MAX_AVATAR_SIZE) {
        message.error(t('avatar.sizeExceeded'));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (result?.url) {
          updateGroupMeta({ avatar: result.url });
        }
      } finally {
        setUploading(false);
      }
    },
    [uploadWithProgress, updateGroupMeta, t],
  );

  // Handle avatar delete
  const handleAvatarDelete = useCallback(() => {
    updateGroupMeta({ avatar: undefined });
  }, [updateGroupMeta]);

  // Handle background color change
  const handleBackgroundColorChange = (color?: string) => {
    if (color !== undefined) {
      updateGroupMeta({ backgroundColor: color });
    }
  };

  return (
    <Flexbox
      gap={16}
      paddingBlock={16}
      style={{
        cursor: 'default',
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {/* Avatar Section */}
      <EmojiPicker
        allowUpload
        allowDelete={!!groupMeta.avatar}
        loading={uploading}
        locale={locale}
        shape={'square'}
        size={72}
        value={groupMeta.avatar}
        background={
          groupMeta.backgroundColor && groupMeta.backgroundColor !== 'rgba(0,0,0,0)'
            ? groupMeta.backgroundColor
            : undefined
        }
        customRender={
          groupMeta.avatar
            ? undefined
            : () => {
                return (
                  <Block clickable height={72} width={72}>
                    <GroupAvatar size={72} />
                  </Block>
                );
              }
        }
        customTabs={[
          {
            label: (
              <Tooltip title={t('backgroundColor.title')}>
                <Icon icon={PaletteIcon} size={{ size: 20, strokeWidth: 2.5 }} />
              </Tooltip>
            ),
            render: () => (
              <Flexbox padding={8} width={332}>
                <Suspense
                  fallback={
                    <Flexbox gap={8}>
                      <Skeleton.Button block style={{ height: 38 }} />
                      <Skeleton.Button block style={{ height: 38 }} />
                    </Flexbox>
                  }
                >
                  <BackgroundSwatches
                    gap={8}
                    shape={'square'}
                    size={38}
                    value={groupMeta.backgroundColor}
                    onChange={handleBackgroundColorChange}
                  />
                </Suspense>
              </Flexbox>
            ),
            value: 'background',
          },
        ]}
        popupProps={{
          placement: 'bottomLeft',
        }}
        onChange={handleAvatarChange}
        onDelete={handleAvatarDelete}
        onUpload={handleAvatarUpload}
      />
      {/* Title Section */}
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Input
          placeholder={t('name.placeholder')}
          value={localTitle}
          variant={'borderless'}
          style={{
            fontSize: 36,
            fontWeight: 600,
            padding: 0,
            width: '100%',
          }}
          onChange={(e) => {
            setLocalTitle(e.target.value);
            debouncedSaveTitle(e.target.value);
          }}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default GroupHeader;
