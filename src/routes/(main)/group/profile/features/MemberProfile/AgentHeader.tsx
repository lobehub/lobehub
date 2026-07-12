'use client';

import { DEFAULT_AVATAR, EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import { Block, Flexbox, Icon, Input, Skeleton, Tooltip } from '@lobehub/ui';
import { message } from 'antd';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { PaletteIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import BackgroundSwatches from '@/features/AgentSetting/AgentMeta/BackgroundSwatches';
import { usePermission } from '@/hooks/usePermission';
import SupervisorAvatar from '@/routes/(main)/group/features/GroupAvatar';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useGroupProfileStore } from '@/store/groupProfile';

const MAX_AVATAR_SIZE = 1024 * 1024; // 1MB limit for server actions

interface AgentHeaderProps {
  disabled?: boolean;
  /**
   * When true, shows fixed title (supervisor) and disables avatar editing
   */
  readOnly?: boolean;
}

const AgentHeader = memo<AgentHeaderProps>(({ readOnly, disabled: disabledProp }) => {
  const { t } = useTranslation(['setting', 'common', 'chat']);
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const disabled = disabledProp || !canEdit;

  // Get agentId from profile store
  const agentId = useGroupProfileStore((s) => s.activeTabId);

  // Get agent meta by agentId
  const agentMeta = useAgentStore(agentSelectors.getAgentMetaById(agentId), isEqual);
  const updateAgentMetaById = useAgentStore((s) => s.updateAgentMetaById);

  // File upload
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [uploading, setUploading] = useState(false);

  // Local state for inputs (to avoid stuttering during typing)
  const [localTitle, setLocalTitle] = useState(agentMeta.title || '');

  // Sync local state when meta changes from external source
  useEffect(() => {
    setLocalTitle(agentMeta.title || '');
  }, [agentId, agentMeta.title]);

  // Debounced save for title - save to agent store
  const debouncedSaveTitle = useMemo(
    () =>
      debounce((targetAgentId: string, value: string) => {
        updateAgentMetaById(targetAgentId, { title: value });
      }, EDITOR_DEBOUNCE_TIME),
    [updateAgentMetaById],
  );

  // Flush before the selected member changes or this profile unmounts. Keeping
  // flush and cancel in the same cleanup avoids ahooks' cancel-before-flush
  // unmount ordering and preserves the title for the member that was edited.
  useEffect(
    () => () => {
      debouncedSaveTitle.flush();
      debouncedSaveTitle.cancel();
    },
    [agentId, debouncedSaveTitle],
  );

  // Handle avatar change (immediate save) - save to agent store (supervisor agent)
  const handleAvatarChange = (emoji: string) => {
    if (disabled) return;

    updateAgentMetaById(agentId, { avatar: emoji });
  };

  // Handle avatar upload
  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (disabled) return;

      if (file.size > MAX_AVATAR_SIZE) {
        message.error(t('settingAgent.avatar.sizeExceeded', { ns: 'setting' }));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (result?.url) {
          updateAgentMetaById(agentId, { avatar: result.url });
        }
      } finally {
        setUploading(false);
      }
    },
    [agentId, disabled, t, updateAgentMetaById, uploadWithProgress],
  );

  // Handle avatar delete
  const handleAvatarDelete = useCallback(() => {
    if (disabled) return;

    updateAgentMetaById(agentId, { avatar: null });
  }, [agentId, disabled, updateAgentMetaById]);

  // Handle background color change (immediate save) - save to agent store (supervisor agent)
  const handleBackgroundColorChange = (color?: string) => {
    if (disabled) return;

    if (color !== undefined) {
      updateAgentMetaById(agentId, { backgroundColor: color });
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
        allowDelete={!disabled && !!agentMeta.avatar}
        allowUpload={!disabled}
        loading={uploading}
        locale={locale}
        open={disabled ? false : undefined}
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
                    disabled={disabled}
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
        disabled={disabled}
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
          if (!agentId || disabled) return;

          debouncedSaveTitle(agentId, e.target.value);
        }}
      />
    </Flexbox>
  );
});

export default AgentHeader;
