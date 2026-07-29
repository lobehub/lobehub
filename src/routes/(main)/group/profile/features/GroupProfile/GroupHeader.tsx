'use client';

import { EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import { Block, Flexbox, Icon, Input, Skeleton, Tooltip } from '@lobehub/ui';
import { message } from 'antd';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { PaletteIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import EmojiPicker from '@/components/EmojiPicker';
import BackgroundSwatches from '@/features/AgentSetting/AgentMeta/BackgroundSwatches';
import { usePermission } from '@/hooks/usePermission';
import GroupAvatar from '@/routes/(main)/group/features/GroupAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

const MAX_AVATAR_SIZE = 1024 * 1024; // 1MB limit for server actions

const GroupHeader = memo(() => {
  const { t } = useTranslation('agentGroup');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  // Get group meta from agentGroup store
  const { gid } = useParams<{ gid: string }>();
  const groupMeta = useAgentGroupStore(
    (s) => agentGroupSelectors.getGroupMeta(gid ?? '')(s),
    isEqual,
  );
  const updateGroupMetaById = useAgentGroupStore((s) => s.updateGroupMetaById);

  // File upload
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [uploading, setUploading] = useState(false);

  // Local state for inputs
  const [localTitle, setLocalTitle] = useState(groupMeta.title || '');

  // Sync local state when meta changes from external source
  useEffect(() => {
    setLocalTitle(groupMeta.title || '');
  }, [gid, groupMeta.title]);

  // Debounced save for title
  const debouncedSaveTitle = useMemo(
    () =>
      debounce((targetGroupId: string, value: string) => {
        updateGroupMetaById(targetGroupId, { title: value });
      }, EDITOR_DEBOUNCE_TIME),
    [updateGroupMetaById],
  );

  // Persist the departing group's pending title before this route unmounts or
  // adopts the next gid. The queued invocation carries its original group ID.
  useEffect(
    () => () => {
      debouncedSaveTitle.flush();
      debouncedSaveTitle.cancel();
    },
    [debouncedSaveTitle, gid],
  );

  // Handle avatar change (immediate save)
  const handleAvatarChange = (emoji: string) => {
    if (!canEdit || !gid) return;

    updateGroupMetaById(gid, { avatar: emoji });
  };

  // Handle avatar upload
  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (!canEdit || !gid) return;

      if (file.size > MAX_AVATAR_SIZE) {
        message.error(t('avatar.sizeExceeded'));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (result?.url) {
          updateGroupMetaById(gid, { avatar: result.url });
        }
      } finally {
        setUploading(false);
      }
    },
    [canEdit, gid, t, updateGroupMetaById, uploadWithProgress],
  );

  // Handle avatar delete
  const handleAvatarDelete = useCallback(() => {
    if (!canEdit || !gid) return;

    updateGroupMetaById(gid, { avatar: undefined });
  }, [canEdit, gid, updateGroupMetaById]);

  // Handle background color change
  const handleBackgroundColorChange = (color?: string) => {
    if (!canEdit || !gid) return;

    if (color !== undefined) {
      updateGroupMetaById(gid, { backgroundColor: color });
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
        allowDelete={canEdit && !!groupMeta.avatar}
        allowUpload={canEdit}
        loading={uploading}
        locale={locale}
        open={canEdit ? undefined : false}
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
                    disabled={!canEdit}
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
          disabled={!canEdit}
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
            if (!canEdit || !gid) return;

            debouncedSaveTitle(gid, e.target.value);
          }}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default GroupHeader;
