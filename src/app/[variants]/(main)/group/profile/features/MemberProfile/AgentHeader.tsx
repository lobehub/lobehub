'use client';

import { DEFAULT_AVATAR, EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import { Block, Flexbox, Icon, Input, Skeleton, Tooltip } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { message } from 'antd';
import isEqual from 'fast-deep-equal';
import { PaletteIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SupervisorAvatar from '@/app/[variants]/(main)/group/features/GroupAvatar';
import EmojiPicker from '@/components/EmojiPicker';
import BackgroundSwatches from '@/features/AgentSetting/AgentMeta/BackgroundSwatches';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useGroupProfileStore } from '@/store/groupProfile';

const MAX_AVATAR_SIZE = 1024 * 1024; // 1MB limit for server actions

interface AgentHeaderProps {
  /**
   * When true, shows fixed title (supervisor) and disables avatar editing
   */
  readOnly?: boolean;
}

const AgentHeader = memo<AgentHeaderProps>(({ readOnly }) => {
  const { t } = useTranslation(['setting', 'common', 'chat']);
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  // Get agentId from profile store
  const agentId = useGroupProfileStore((s) => s.activeTabId);

  // Get agent meta by agentId
  const agentMeta = useAgentStore(agentSelectors.getAgentMetaById(agentId), isEqual);
  const optimisticUpdateAgentMeta = useAgentStore((s) => s.optimisticUpdateAgentMeta);

  // File upload
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [uploading, setUploading] = useState(false);

  // Local state for inputs (to avoid stuttering during typing)
  const [localTitle, setLocalTitle] = useState(agentMeta.title || '');

  // Sync local state when meta changes from external source
  useEffect(() => {
    setLocalTitle(agentMeta.title || '');
  }, [agentMeta.title]);

  // Debounced save for title - save to agent store
  const { run: debouncedSaveTitle } = useDebounceFn(
    (value: string) => {
      optimisticUpdateAgentMeta(agentId, { title: value });
    },
    { wait: EDITOR_DEBOUNCE_TIME },
  );

  // Handle avatar change (immediate save) - save to agent store (supervisor agent)
  const handleAvatarChange = (emoji: string) => {
    optimisticUpdateAgentMeta(agentId, { avatar: emoji });
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
          optimisticUpdateAgentMeta(agentId, { avatar: result.url });
        }
      } finally {
        setUploading(false);
      }
    },
    [uploadWithProgress, optimisticUpdateAgentMeta, agentId, t],
  );

  // Handle avatar delete
  const handleAvatarDelete = useCallback(() => {
    optimisticUpdateAgentMeta(agentId, { avatar: undefined });
  }, [optimisticUpdateAgentMeta, agentId]);

  // Handle background color change (immediate save) - save to agent store (supervisor agent)
  const handleBackgroundColorChange = (color?: string) => {
    if (color !== undefined) {
      optimisticUpdateAgentMeta(agentId, { backgroundColor: color });
    }
  };

  // ReadOnly mode: show fixed avatar and title (for supervisor)
  if (readOnly) {
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
        <Block height={72} width={72}>
          <SupervisorAvatar size={72} />
        </Block>
        <Flexbox
          style={{
            fontSize: 36,
            fontWeight: 600,
          }}
        >
          {t('group.profile.supervisor', { ns: 'chat' })}
        </Flexbox>
      </Flexbox>
    );
  }

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
      <EmojiPicker
        allowUpload
        allowDelete={!!agentMeta.avatar}
        loading={uploading}
        locale={locale}
        shape={'square'}
        size={72}
        value={agentMeta.avatar}
        background={
          agentMeta.backgroundColor && agentMeta.backgroundColor !== 'rgba(0,0,0,0)'
            ? agentMeta.backgroundColor
            : undefined
        }
        customRender={
          agentMeta.avatar && agentMeta.avatar !== DEFAULT_AVATAR
            ? undefined
            : () => {
                return (
                  <Block clickable height={72} width={72}>
                    <SupervisorAvatar size={72} />
                  </Block>
                );
              }
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
                    value={agentMeta.backgroundColor}
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
  );
});

export default AgentHeader;
