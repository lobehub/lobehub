'use client';

import { EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import { Flexbox, Icon, Input, Skeleton, Tooltip } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { message } from 'antd';
import isEqual from 'fast-deep-equal';
import { PaletteIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import BackgroundSwatches from '@/features/AgentSetting/AgentMeta/BackgroundSwatches';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

const MAX_AVATAR_SIZE = 1024 * 1024; // 1MB limit for server actions

const AgentHeader = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  // Get current meta from store
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const updateMeta = useAgentStore((s) => s.updateAgentMeta);

  // File upload
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [uploading, setUploading] = useState(false);

  // Local state for inputs (to avoid stuttering during typing)
  const [localTitle, setLocalTitle] = useState(meta.title || '');

  // Sync local state when meta changes from external source
  useEffect(() => {
    setLocalTitle(meta.title || '');
  }, [meta.title]);

  // Debounced save for title
  const { run: debouncedSaveTitle } = useDebounceFn(
    (value: string) => {
      updateMeta({ title: value });
    },
    { wait: EDITOR_DEBOUNCE_TIME },
  );

  // Handle avatar change (immediate save)
  const handleAvatarChange = (emoji: string) => {
    updateMeta({ avatar: emoji });
  };

  // Handle avatar upload
  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (file.size > MAX_AVATAR_SIZE) {
        message.error(t('settingAgent.avatar.sizeExceeded', { ns: 'setting' }));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (result?.url) {
          updateMeta({ avatar: result.url });
        }
      } finally {
        setUploading(false);
      }
    },
    [uploadWithProgress, updateMeta, t],
  );

  // Handle avatar delete
  const handleAvatarDelete = useCallback(() => {
    updateMeta({ avatar: undefined });
  }, [updateMeta]);

  // Handle background color change (immediate save)
  const handleBackgroundColorChange = (color?: string) => {
    if (color !== undefined) {
      updateMeta({ backgroundColor: color });
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
        allowDelete={!!meta.avatar}
        loading={uploading}
        locale={locale}
        shape={'square'}
        size={72}
        value={meta.avatar}
        background={
          meta.backgroundColor && meta.backgroundColor !== 'rgba(0,0,0,0)'
            ? meta.backgroundColor
            : undefined
        }
        customTabs={[
          {
            label: (
              <Tooltip title={t('settingAgent.backgroundColor.title', { ns: 'setting' })}>
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
                    value={meta.backgroundColor}
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
          placeholder={t('settingAgent.name.placeholder', { ns: 'setting' })}
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

export default AgentHeader;
